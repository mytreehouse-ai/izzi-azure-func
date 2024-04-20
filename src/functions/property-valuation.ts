import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { z } from 'zod'
import { getPoolDb } from '../database/neon'
import { processNumber } from '../utils/processNumber'
import { formatCurrency } from '../utils/formatCurrency'
import { removeExtraSpaces } from '../utils/removeExtraSpaces'

const querySchema = z.object({
    property_type: z.enum(['Condominium', 'House', 'Warehouse']),
    city: z.string().optional(),
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
        const { property_type, city, sqm } = parsedQueryParams.data

        function areaSize(propertyType: string) {
            switch (propertyType) {
                case 'Condominium':
                    return 'p.floor_area BETWEEN $3 * 0.8 AND $3 * 1.2'
                case 'Warehouse':
                    return 'p.building_size BETWEEN $3 * 0.8 AND $3 * 1.2'
                default:
                    return 'p.lot_area BETWEEN $3 * 0.8 AND $3 * 1.2'
            }
        }

        function formatPrice(price: string | null) {
            return `₱${price ?? '0'}`
        }

        function sqlQueryValuation(listingType: string, propertyType: string) {
            return `
                SELECT TO_CHAR(ROUND(AVG(price)::numeric, 2), 'FM999,999,999,990D00') AS average_price
                FROM listing l
                    INNER JOIN property p on l.id = p.listing_id
                    INNER JOIN property_status ps on l.property_status_id = ps.id
                    INNER JOIN listing_type lt on l.listing_type_id = lt.id
                    INNER JOIN property_type pt on p.property_type_id = pt.id
                    ${city ? 'INNER JOIN city ON city.id = p.city_id' : ''}
                WHERE
                    ps.name = $1
                    AND lt.name = '${listingType}'
                    AND pt.name = $2
                    ${city ? `AND city.name = '${city}'` : ''}
                AND ${areaSize(propertyType)};
            `
        }

        function sqlQuerySimilarProperties(
            listingType: string,
            propertyType: string
        ) {
            return `
                SELECT 
                    l.id, 
                    l.listing_title,
                    l.listing_url,
                    l.price_formatted 
                FROM listing l
                    INNER JOIN property p on l.id = p.listing_id
                    INNER JOIN property_status ps on l.property_status_id = ps.id
                    INNER JOIN listing_type lt on l.listing_type_id = lt.id
                    INNER JOIN property_type pt on p.property_type_id = pt.id
                    ${city ? 'INNER JOIN city ON city.id = p.city_id' : ''}
                WHERE
                    ps.name = $1
                    AND lt.name = '${listingType}'
                    AND pt.name = $2
                    AND ${areaSize(propertyType)}
                    ${city ? `AND city.name = '${city}'` : ''}
                ORDER BY l.created_at DESC
                LIMIT 10;
            `
        }

        const sqlQueryValuationForSale = removeExtraSpaces(
            sqlQueryValuation('For Sale', property_type)
        )

        const sqlQuerySimilarPropertiesForSale = removeExtraSpaces(
            sqlQuerySimilarProperties('For Sale', property_type)
        )

        const sqlQueryValuationForRent = removeExtraSpaces(
            sqlQueryValuation('For Rent', property_type)
        )

        const sqlQuerySimilarPropertiesForRent = removeExtraSpaces(
            sqlQuerySimilarProperties('For Rent', property_type)
        )

        await client.query('BEGIN')

        const propertyValuationForSale = await client.query(
            sqlQueryValuationForSale,
            [propertyStatus, property_type, sqm]
        )

        const similarPropertiesForSale = await client.query(
            sqlQuerySimilarPropertiesForSale,
            [propertyStatus, property_type, sqm]
        )

        const propertyValuationForRent = await client.query(
            sqlQueryValuationForRent,
            [propertyStatus, property_type, sqm]
        )

        const similarPropertiesForRent = await client.query(
            sqlQuerySimilarPropertiesForRent,
            [propertyStatus, property_type, sqm]
        )

        await client.query('COMMIT')

        const saleAveragePrice = propertyValuationForSale.rowCount
            ? propertyValuationForSale.rows[0].average_price
            : 0

        const salePricePerSqm =
            parseFloat(saleAveragePrice?.replace(/,/g, '')) / sqm

        const rentAveragePrice = propertyValuationForRent.rowCount
            ? propertyValuationForRent.rows[0].average_price
            : 0

        const rentPricePerSqm =
            parseFloat(rentAveragePrice?.replace(/,/g, '')) / sqm

        return {
            jsonBody: {
                data: {
                    valuation: {
                        sale: {
                            average_price: formatPrice(saleAveragePrice),
                            price_per_sqm: formatCurrency(
                                formatPrice(
                                    String(
                                        isNaN(salePricePerSqm)
                                            ? 0
                                            : salePricePerSqm
                                    )
                                )
                            ),
                            similar_properties: similarPropertiesForSale.rows,
                        },
                        rent: {
                            average_price: formatPrice(rentAveragePrice),
                            price_per_sqm: formatCurrency(
                                formatPrice(
                                    String(
                                        isNaN(rentPricePerSqm)
                                            ? 0
                                            : rentPricePerSqm
                                    )
                                )
                            ),
                            similar_properties: similarPropertiesForRent.rows,
                        },
                        property_type,
                        sqm,
                    },
                },
            },
        }
    } catch (error) {
        await client.query('ROLLBACK')

        console.log(error)

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
