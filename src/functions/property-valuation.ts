import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { z } from 'zod'
import { processNumber } from '../utils/processNumber'
import { getPoolDb } from '../database/neon'

const querySchema = z.object({
    property_type: z.enum(['Condominium', 'House', 'Warehouse']),
    listing_type: z.enum(['For Sale', 'For Rent']),
    area: z.string().min(4),
    sqm: z.preprocess((val) => processNumber(String(val)), z.number().min(20)),
})

export async function propertyValuation(
    request: HttpRequest,
    _context: InvocationContext
): Promise<HttpResponseInit> {
    const databaseUrl = process.env['NEON_DATABASE_URL']

    if (!databaseUrl) {
        return {
            jsonBody: {
                message: 'Database URL not defined.',
            },
            status: 500,
        }
    }

    const requestQuery = new URLSearchParams(request.query)
    const queryObject = Object.fromEntries(requestQuery.entries())

    const parsedQueryParams = await querySchema.safeParseAsync(queryObject)

    if (parsedQueryParams.success === false) {
        const error = parsedQueryParams.error.issues[0]

        return {
            jsonBody: {
                message: `[${error.path}]: ${error.message}`.toLowerCase(),
            },
            status: 400,
        }
    }

    const { client, pool } = await getPoolDb(databaseUrl)

    try {
        const propertyStatus = 'Available'
        const { listing_type, property_type, area, sqm } =
            parsedQueryParams.data

        function areaSize(propertyType: string) {
            switch (propertyType) {
                case 'Condominium':
                    return 'p.floor_area BETWEEN $5 * 0.8 AND $5 * 1.2'
                case 'Warehouse':
                    return 'p.building_size BETWEEN $5 * 0.8 AND $5 * 1.2'
                default:
                    return 'p.lot_area BETWEEN $5 * 0.8 AND $5 * 1.2'
            }
        }

        function formatPrice(price: string) {
            return `₱${price ?? '0'}`
        }

        const sqlQueryValuation = `
            SELECT TO_CHAR(ROUND(AVG(price)::numeric, 2), 'FM999,999,999,990D00') AS average_price
            FROM listing l
                INNER JOIN property p on l.id = p.listing_id
                INNER JOIN property_status ps on l.property_status_id = ps.id
                INNER JOIN listing_type lt on l.listing_type_id = lt.id
                INNER JOIN property_type pt on p.property_type_id = pt.id
                INNER JOIN city c on p.city_id = c.id
            WHERE
                ps.name = $1
                AND lt.name = $2
                AND pt.name = $3
                AND c.name = $4
            AND {sqm};
        `.replace('{sqm}', areaSize(property_type))

        const sqlQuerySimilarProperties = `
            SELECT p.id FROM listing l
                INNER JOIN property p on l.id = p.listing_id
                INNER JOIN property_status ps on l.property_status_id = ps.id
                INNER JOIN listing_type lt on l.listing_type_id = lt.id
                INNER JOIN property_type pt on p.property_type_id = pt.id
                INNER JOIN city c on p.city_id = c.id
            WHERE
                ps.name = $1
                AND lt.name = $2
                AND pt.name = $3
                AND c.name = $4
                AND {sqm}
            ORDER BY l.created_at DESC
            LIMIT 10;
        `.replace('{sqm}', areaSize(property_type))

        await client.query('BEGIN')

        const propertyValuation = await client.query(sqlQueryValuation, [
            propertyStatus,
            listing_type,
            property_type,
            area,
            sqm,
        ])

        const similarProperties = await client.query(
            sqlQuerySimilarProperties,
            [propertyStatus, listing_type, property_type, area, sqm]
        )

        await client.query('COMMIT')

        return {
            jsonBody: {
                data: {
                    valuation: {
                        average_price: propertyValuation.rowCount
                            ? formatPrice(
                                  propertyValuation.rows[0].average_price
                              )
                            : 0,
                        property_type,
                        listing_type,
                        area,
                        sqm,
                    },
                    similar_properties: similarProperties.rowCount
                        ? similarProperties.rows.map((r) => r.id)
                        : [],
                },
            },
        }
    } catch (error) {
        await client.query('ROLLBACK')

        return {
            jsonBody: {
                message: 'Something went wrong.' || error?.message,
            },
            status: 500,
        }
    } finally {
        client.release()
        pool.end()
    }
}

app.http('property-valuation', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: propertyValuation,
})
