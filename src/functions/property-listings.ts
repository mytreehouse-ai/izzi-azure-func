import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { z } from 'zod'
import { processNumber } from '../utils/processNumber'
import { removeExtraSpaces } from '../utils/removeExtraSpaces'
import { getPoolDb } from '../database/neon'

const propertyTypes = z.enum(['condominium', 'house', 'warehouse', 'land'])
const listingTypes = z.enum(['for-sale', 'for-rent'])

const querySchema = z.object({
    search: z.string().optional(),
    property_type: propertyTypes.optional(),
    listing_type: listingTypes.optional(),
    min_price: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_price: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    min_bedrooms: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_bedrooms: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    min_bathrooms: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_bathrooms: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    min_car_spaces: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_car_spaces: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    min_floor_size: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_floor_size: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    min_lot_size: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_lot_size: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    min_building_size: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    max_building_size: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    before: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
    after: z
        .preprocess((val) => processNumber(String(val)), z.number())
        .optional(),
})

export async function propertyListings(
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

    const { client, pool } = await getPoolDb(databaseUrl)

    try {
        const requestMethod = request.method
        const listingId = request.params.id

        if (requestMethod === 'GET' && listingId) {
            const findOnePropertyListingSqlQuery = `
                WITH listing_details AS (
                    SELECT
                        listing.id,
                        INITCAP(listing.listing_title) AS listing_title,
                        listing.listing_url,
                        listing.price,
                        listing.price_formatted,
                        listing.price_for_rent_per_sqm,
                        listing.price_for_sale_per_sqm,
                        listing.price_for_rent_per_sqm_formatted,
                        listing.price_for_sale_per_sqm_formatted,
                        listing_type.name AS listing_type,
                        property_status.name AS property_status,
                        property_type.name AS property_type,
                        listing.sub_category,
                        property.building_name,
                        property.subdivision_name,
                        property.floor_area,
                        property.lot_area,
                        property.building_size,
                        property.bedrooms,
                        property.bathrooms,
                        property.parking_space,
                        city.name AS city,
                        property.area,
                        property.address,
                        property.features,
                        property.main_image_url,
                        ST_AsGeoJSON(listing.coordinates) :: json->'coordinates' AS coordinates,
                        listing.latitude_in_text,
                        listing.longitude_in_text,
                        listing.description,
                        listing.scraped_property,
                        listing.created_at
                    FROM listing
                    INNER JOIN listing_type ON listing_type.id = listing.listing_type_id
                    INNER JOIN property_status ON property_status.id = listing.property_status_id
                    INNER JOIN property ON property.listing_id = listing.id
                    INNER JOIN property_type ON property_type.id = property.property_type_id
                    INNER JOIN city ON city.id = property.city_id
                    WHERE listing.id = $1
                ),
                property_images_agg AS (
                    SELECT
                        property_id,
                        ARRAY_AGG(
                            JSON_BUILD_OBJECT(
                                'id', id,
                                'url', url
                            )
                        ) AS property_images
                    FROM property_images
                    GROUP BY property_id
                )
                SELECT
                    ld.*,
                    pia.property_images
                FROM listing_details ld
                LEFT JOIN property_images_agg pia ON pia.property_id = ld.id;
            `

            const query = await client.query(findOnePropertyListingSqlQuery, [
                listingId,
            ])

            return {
                jsonBody: {
                    data: query.rows[0],
                },
            }
        }

        if (requestMethod === 'POST') {
            return {
                jsonBody: {
                    data: {},
                },
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

        const queryParams = parsedQueryParams.data

        const defaultSqlQuery = `
			SELECT
				listing.id,
				INITCAP(listing.listing_title) AS listing_title,
				listing.listing_url,
				listing.price,
				listing.price_formatted,
				listing.price_for_rent_per_sqm,
				listing.price_for_sale_per_sqm,
				listing.price_for_rent_per_sqm_formatted,
				listing.price_for_sale_per_sqm_formatted,
				listing_type.name AS listing_type,
				property_status.name AS property_status,
				property_type.name AS property_type,
				listing.sub_category,
				property.building_name,
				property.subdivision_name,
				property.floor_area,
				property.lot_area,
				property.building_size,
				property.bedrooms,
				property.bathrooms,
				property.parking_space,
				city.name AS city,
				property.area,
				property.address,
				property.features,
				property.main_image_url,
				ST_AsGeoJSON(listing.coordinates) :: json->'coordinates' AS coordinates,
				listing.latitude_in_text,
				listing.longitude_in_text,
				listing.description,
				listing.created_at
			FROM listing
			INNER JOIN listing_type ON listing_type.id = listing.listing_type_id
			INNER JOIN property_status ON property_status.id = listing.property_status_id
			INNER JOIN property ON property.listing_id = listing.id
			INNER JOIN property_type ON property_type.id = property.property_type_id
			INNER JOIN city ON city.id = property.city_id
			WHERE property_status.slug = $1
			${
                queryParams?.property_type
                    ? `AND property_type.slug = '${queryParams.property_type}'`
                    : ''
            }
			${
                queryParams?.listing_type
                    ? `AND listing_type.slug = '${queryParams.listing_type}'`
                    : ''
            }
			${
                queryParams?.min_bedrooms && queryParams?.max_bedrooms
                    ? `AND property.bedrooms >= ${queryParams.min_bedrooms} AND property.bedrooms <= ${queryParams.max_bedrooms}`
                    : ''
            }
			${
                queryParams?.min_bathrooms && queryParams?.max_bathrooms
                    ? `AND property.bathrooms >= ${queryParams.min_bathrooms} AND property.bathrooms <= ${queryParams.max_bathrooms}`
                    : ''
            }
			${
                queryParams?.min_car_spaces && queryParams?.max_car_spaces
                    ? `AND property.parking_space >= ${queryParams.min_car_spaces} AND property.parking_space <= ${queryParams.max_car_spaces}`
                    : ''
            }
			${
                queryParams?.after && !queryParams?.before
                    ? `AND listing.id < ${queryParams.after}`
                    : ''
            }
			${
                queryParams?.before && !queryParams?.after
                    ? `AND listing.id > ${queryParams.before}`
                    : ''
            }
			ORDER BY listing.id DESC
			LIMIT 10
		`

        const sqlQueryWithWordSimilaritySearch = `
			WITH similarity AS (
				SELECT
					listing.id,
					INITCAP(listing.listing_title) AS listing_title,
					listing.listing_url,
					listing.price,
					listing.price_formatted,
					listing.price_for_rent_per_sqm,
					listing.price_for_sale_per_sqm,
					listing.price_for_rent_per_sqm_formatted,
					listing.price_for_sale_per_sqm_formatted,
					listing_type.name AS listing_type,
					property_status.name AS property_status,
					property_type.name AS property_type,
					listing.sub_category,
					property.building_name,
					property.subdivision_name,
					property.floor_area,
					property.lot_area,
					property.building_size,
					property.bedrooms,
					property.bathrooms,
					property.parking_space,
					city.name AS city,
					property.area,
					property.address,
					property.features,
					property.main_image_url,
					ST_AsGeoJSON(listing.coordinates) :: json->'coordinates' AS coordinates,
					listing.latitude_in_text,
					listing.longitude_in_text,
					WORD_SIMILARITY(listing.description, '${
                        queryParams.search
                    }') AS description_similarity,
					listing.description,
					listing.created_at
				FROM listing
				INNER JOIN listing_type ON listing_type.id = listing.listing_type_id
				INNER JOIN property_status ON property_status.id = listing.property_status_id
				INNER JOIN property ON property.listing_id = listing.id
				INNER JOIN property_type ON property_type.id = property.property_type_id
				INNER JOIN city ON city.id = property.city_id
				WHERE property_status.slug = $1
				${
                    queryParams?.property_type
                        ? `AND property_type.slug = '${queryParams.property_type}'`
                        : ''
                }
				${
                    queryParams?.listing_type
                        ? `AND listing_type.slug = '${queryParams.listing_type}'`
                        : ''
                }
				AND WORD_SIMILARITY(listing.description, '${queryParams.search}') > 0
				${
                    queryParams?.min_bedrooms && queryParams?.max_bedrooms
                        ? `AND property.bedrooms >= ${queryParams.min_bedrooms} AND property.bedrooms <= ${queryParams.max_bedrooms}`
                        : ''
                }
				${
                    queryParams?.min_bathrooms && queryParams?.max_bathrooms
                        ? `AND property.bathrooms >= ${queryParams.min_bathrooms} AND property.bathrooms <= ${queryParams.max_bathrooms}`
                        : ''
                }
				${
                    queryParams?.min_car_spaces && queryParams?.max_car_spaces
                        ? `AND property.parking_space >= ${queryParams.min_car_spaces} AND property.parking_space <= ${queryParams.max_car_spaces}`
                        : ''
                }
			)
			SELECT *
			FROM similarity
			${
                queryParams?.after && !queryParams?.before
                    ? `WHERE description_similarity < ${queryParams.after}`
                    : ''
            }
			${
                queryParams?.before && !queryParams?.after
                    ? `WHERE description_similarity > ${queryParams.before}`
                    : ''
            }
			ORDER BY description_similarity DESC
			LIMIT 10;
		`

        const sqlQuery = removeExtraSpaces(
            queryParams?.search
                ? sqlQueryWithWordSimilaritySearch
                : defaultSqlQuery
        )

        const query = await client.query(sqlQuery, ['available'])

        const recordCount = query.rows.length

        return {
            jsonBody: {
                before: recordCount ? query.rows[0].id : null,
                after: recordCount ? query.rows[recordCount - 1].id : null,
                data: query.rows,
            },
        }
    } catch (error) {
        return {
            jsonBody: {
                message: 'Something went wrong.' || error?.message,
            },
            status: 500,
        }
    } finally {
        pool.end()
    }
}

app.http('property-listings', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'property-listings/{id:int?}',
    handler: propertyListings,
})
