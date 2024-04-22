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
    user_id: z.string().optional(),
    property_type: z.enum(['Condominium', 'House', 'Warehouse', 'Land']),
    sqm: z.preprocess((val) => processNumber(String(val)), z.number().min(20)),
    city: z.string().optional(),
    address: z.string(),
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
        const { user_id, property_type, city, address, sqm } =
            parsedQueryParams.data

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

        function sqlQueryValuation(options: {
            listingType: string
            propertyType: string
        }) {
            const { listingType, propertyType } = options

            return `
                SELECT AVG(price) AS average_price
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

        function sqlQuerySimilarProperties(options: {
            listingType: string
            propertyType: string
        }) {
            const { listingType, propertyType } = options

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
            sqlQueryValuation({
                listingType: 'For Sale',
                propertyType: property_type,
            })
        )

        const sqlQuerySimilarPropertiesForSale = removeExtraSpaces(
            sqlQuerySimilarProperties({
                listingType: 'For Sale',
                propertyType: property_type,
            })
        )

        const sqlQueryValuationForRent = removeExtraSpaces(
            sqlQueryValuation({
                listingType: 'For Rent',
                propertyType: property_type,
            })
        )

        const sqlQuerySimilarPropertiesForRent = removeExtraSpaces(
            sqlQuerySimilarProperties({
                listingType: 'For Rent',
                propertyType: property_type,
            })
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

        const saleAveragePrice = propertyValuationForSale.rows[0].average_price

        const averageSalePricePerSqm = parseFloat(saleAveragePrice) / sqm

        const salePricePerSqm = formatCurrency(String(averageSalePricePerSqm))

        const rentAveragePrice = propertyValuationForRent.rows[0].average_price

        const averageRentPricePerSqm = parseFloat(rentAveragePrice) / sqm

        const rentPricePerSqm = formatCurrency(String(averageRentPricePerSqm))

        if (user_id) {
            const ct = await client.query(
                'SELECT id FROM city WHERE name = $1;',
                [city ?? null]
            )

            enum PropertyType {
                'Condominium' = 1,
                'House' = 2,
                'Warehouse' = 3,
                'Land' = 4,
                'Apartment' = 5,
            }

            const user = await client.query(
                `WITH upsert AS (
                    INSERT INTO "user" (clerk_id)
                    VALUES ($1)
                    ON CONFLICT (clerk_id) DO NOTHING
                    RETURNING id
                )
                SELECT id FROM upsert
                UNION ALL
                SELECT id FROM "user" WHERE clerk_id = $1
                LIMIT 1;`,
                [user_id]
            )

            if (user.rowCount) {
                await client.query(
                    `INSERT INTO valuation (
                        user_id,
                        city_id,
                        address,
                        property_size,
                        property_type_id,
                        estimated_formatted_average_price_sale,
                        estimated_formatted_average_price_per_sqm_sale,
                        top_ten_similar_properties_sale,
                        estimated_formatted_average_price_rent,
                        estimated_formatted_average_price_per_sqm_rent,
                        top_ten_similar_properties_rent
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
                    )`,
                    [
                        user_id,
                        ct.rowCount ? ct.rows[0].id : null,
                        address,
                        sqm,
                        PropertyType[property_type],
                        formatCurrency(String(saleAveragePrice)),
                        salePricePerSqm,
                        similarPropertiesForSale.rows,
                        formatCurrency(String(rentAveragePrice)),
                        rentPricePerSqm,
                        similarPropertiesForRent.rows,
                    ]
                )
            }
        }

        await client.query('COMMIT')

        return {
            jsonBody: {
                data: {
                    valuation: {
                        sale: {
                            average_price: formatCurrency(
                                String(saleAveragePrice)
                            ),
                            price_per_sqm: salePricePerSqm,
                            similar_properties: similarPropertiesForSale.rows,
                        },
                        rent: {
                            average_price: formatCurrency(
                                String(rentAveragePrice)
                            ),
                            price_per_sqm: rentPricePerSqm,
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
        console.error(error)

        return {
            jsonBody: {
                message: 'Something went wrong.' || error?.message,
            },
            status: 500,
        }
    } finally {
        client.release()
        await pool.end()
    }
}

app.http('property-valuation', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: propertyValuation,
})
