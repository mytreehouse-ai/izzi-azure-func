import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { z } from 'zod'
import { getPoolDb } from '../database/neon'
import { formatCurrency } from '../utils/formatCurrency'
import { processNumber } from '../utils/processNumber'
import { removeExtraSpaces } from '../utils/removeExtraSpaces'

const propertyTypes = z.enum([
    'condominium',
    'house-and-lot',
    'warehouse',
    'land',
])

const querySchema = z.object({
    user_id: z.string().optional(),
    property_type: propertyTypes,
    sqm: z.preprocess((val) => processNumber(String(val)), z.number().min(20)),
    city: z.string(),
    address: z.string(),
    google_places_data_id: z.string().optional(),
    google_places_details_id: z.string().optional(),
})

export async function propertyValuation(
    request: HttpRequest,
    _context: InvocationContext
): Promise<HttpResponseInit> {
    const databaseUrl = process.env['NEON_LISTD_DATABASE_URL']

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
        const property_status = 'Available'
        const {
            user_id,
            property_type,
            city,
            address,
            sqm,
            google_places_data_id,
            google_places_details_id,
        } = parsedQueryParams.data

        function areaSize(propertyType: string) {
            switch (propertyType) {
                case 'condominium':
                    return 'p.floor_area BETWEEN $3 * 0.8 AND $3 * 1.2'
                case 'warehouse':
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
                FROM listings l
                    INNER JOIN properties p on l.id = p.listing_id
                    INNER JOIN property_status ps on l.property_status_id = ps.id
                    INNER JOIN listing_types lt on l.listing_type_id = lt.id
                    INNER JOIN property_types pt on p.property_type_id = pt.id
                    INNER JOIN cities ON cities.id = p.city_id
                WHERE
                    ps.name = $1
                    AND pt.slug = $2
                    AND lt.slug = '${listingType}'
                    AND STRICT_WORD_SIMILARITY(cities.name, $4) > 0.5
                    AND l.price >= 5000
                    AND ${areaSize(propertyType)};
            `
        }

        function sqlQuerySimilarProperties(options: {
            listingType: string
            propertyType: string
        }) {
            const { listingType, propertyType } = options

            return `
                WITH strict_similarity_word AS (
                    SELECT 
                        l.id,
                        l.listing_title,
                        l.listing_url,
                        l.price_formatted,
                        STRICT_WORD_SIMILARITY(cities.name, $4) AS city_name_similarity
                    FROM listings l
                        INNER JOIN properties p on l.id = p.listing_id
                        INNER JOIN property_status ps on l.property_status_id = ps.id
                        INNER JOIN listing_types lt on l.listing_type_id = lt.id
                        INNER JOIN property_types pt on p.property_type_id = pt.id
                        INNER JOIN cities ON cities.id = p.city_id
                    WHERE
                        ps.name = $1
                        AND pt.slug = $2
                        AND lt.slug = '${listingType}'
                        AND STRICT_WORD_SIMILARITY(cities.name, $4) > 0.5
                        AND l.price >= 5000
                        AND ${areaSize(propertyType)}
                )
                SELECT * FROM strict_similarity_word ORDER BY city_name_similarity DESC LIMIT 10
            `
        }

        const sqlQueryValuationForSale = removeExtraSpaces(
            sqlQueryValuation({
                listingType: 'for-sale',
                propertyType: property_type,
            })
        )

        const sqlQuerySimilarPropertiesForSale = removeExtraSpaces(
            sqlQuerySimilarProperties({
                listingType: 'for-sale',
                propertyType: property_type,
            })
        )

        const sqlQueryValuationForRent = removeExtraSpaces(
            sqlQueryValuation({
                listingType: 'for-rent',
                propertyType: property_type,
            })
        )

        const sqlQuerySimilarPropertiesForRent = removeExtraSpaces(
            sqlQuerySimilarProperties({
                listingType: 'for-rent',
                propertyType: property_type,
            })
        )

        await client.query('BEGIN')

        const propertyValuationForSale = await client.query(
            sqlQueryValuationForSale,
            [property_status, property_type, sqm, city]
        )

        const similarPropertiesForSale = await client.query(
            sqlQuerySimilarPropertiesForSale,
            [property_status, property_type, sqm, city]
        )

        const propertyValuationForRent = await client.query(
            sqlQueryValuationForRent,
            [property_status, property_type, sqm, city]
        )

        const similarPropertiesForRent = await client.query(
            sqlQuerySimilarPropertiesForRent,
            [property_status, property_type, sqm, city]
        )

        const saleAveragePrice = propertyValuationForSale.rows[0].average_price

        const averageSalePricePerSqm = parseFloat(saleAveragePrice) / sqm

        const salePricePerSqm = formatCurrency(String(averageSalePricePerSqm))

        const rentAveragePrice = propertyValuationForRent.rows[0].average_price

        const averageRentPricePerSqm = parseFloat(rentAveragePrice) / sqm

        const rentPricePerSqm = formatCurrency(String(averageRentPricePerSqm))

        if (user_id) {
            const ct = await client.query(
                `WITH strict_similarity_word AS (
                    SELECT 
                        id,
                        STRICT_WORD_SIMILARITY(cities.name, $1) AS city_name_similarity
                    FROM 
                        cities
                    WHERE 
                        STRICT_WORD_SIMILARITY(cities.name, $1) > 0.5
                )
                SELECT * FROM strict_similarity_word ORDER BY city_name_similarity DESC LIMIT 1`,
                [city]
            )

            enum PropertyType {
                'Condominium' = 1,
                'House' = 2,
                'Warehouse' = 3,
                'Land' = 4,
            }

            const user = await client.query(
                `WITH upsert AS (
                    INSERT INTO users (clerk_id)
                    VALUES ($1)
                    ON CONFLICT (clerk_id) DO NOTHING
                    RETURNING id
                )
                SELECT id FROM upsert
                UNION ALL
                SELECT id FROM users WHERE clerk_id = $1
                LIMIT 1;`,
                [user_id]
            )

            if (user.rowCount) {
                await client.query(
                    `INSERT INTO valuations (
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
                        top_ten_similar_properties_rent,
                        google_places_data_id,
                        google_places_details_id
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
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
                        google_places_data_id ?? null,
                        google_places_details_id ?? null,
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
