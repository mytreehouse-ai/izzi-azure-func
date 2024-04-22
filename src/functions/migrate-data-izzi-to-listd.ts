import { app, InvocationContext, Timer } from '@azure/functions'
import { getPoolDb } from '../database/neon'

const izziListingQuery = `
    SELECT
        listing.id,
        listing.agent_id,
        INITCAP(listing.listing_title) AS listing_title,
        listing.listing_url,
        listing.price,
        listing.price_formatted,
        listing.price_for_rent_per_sqm,
        listing.price_for_sale_per_sqm,
        listing.price_for_rent_per_sqm_formatted,
        listing.price_for_sale_per_sqm_formatted,
        listing_type.id AS listing_type_id,
        listing_type.name AS listing_type,
        property_status.id AS property_status_id,
        property_status.name AS property_status,
        property_type.id AS property_type_id,
        property_type.name AS property_type,
        listing.sub_category,
        listing.slug,
        property.id AS property_id,
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
        listing.latitude_in_text,
        listing.longitude_in_text,
        listing.description
    FROM listing
    INNER JOIN listing_type ON listing_type.id = listing.listing_type_id
    INNER JOIN property_status ON property_status.id = listing.property_status_id
    INNER JOIN property ON property.listing_id = listing.id
    INNER JOIN property_type ON property_type.id = property.property_type_id
    INNER JOIN city ON city.id = property.city_id
    WHERE listing.migrated_to_listd = false
    LIMIT 10;
`

export async function migrateDataIzziToListd(
    myTimer: Timer,
    context: InvocationContext
): Promise<void> {
    const databaIzziseUrl = process.env['NEON_DATABASE_URL']
    const databaseListdUrl = process.env['NEON_LISTD_DATABASE_URL']

    const { client: izziClient, pool: izziPool } =
        await getPoolDb(databaIzziseUrl)

    const { client: listdClient, pool: listdPool } =
        await getPoolDb(databaseListdUrl)

    try {
        const listings = await izziClient.query(izziListingQuery)

        listings.rows.forEach(async (listing) => {
            const city = listing.city

            const listdCity = await listdClient.query(
                'SELECT id FROM cities WHERE name = $1 LIMIT 1',
                [city]
            )

            if (listdCity.rowCount) {
                let agentId: number

                const izziPropertyImages = await izziClient.query(
                    'SELECT * FROM property_images WHERE property_id = $1;',
                    [listing.property_id]
                )

                if (listing.agent_id) {
                    const izziPropertyAgent = await izziClient.query(
                        'SELECT * FROM agent WHERE id = $1;',
                        [listing.agent_id]
                    )

                    if (izziPropertyAgent.rowCount) {
                        const listdPropertyAgent = await listdClient.query(
                            `WITH upsert AS (
                                INSERT INTO property_agents (name)
                                VALUES ($1)
                                ON CONFLICT (name) DO NOTHING
                                RETURNING id
                            )
                            SELECT id FROM upsert
                            UNION ALL
                            SELECT id FROM property_agents WHERE name = $1
                            LIMIT 1;`,
                            [izziPropertyAgent.rows[0].name]
                        )

                        agentId = listdPropertyAgent.rows[0].id
                    }
                }

                await listdClient.query('BEGIN')
                const listdListingExist = await listdClient.query(
                    'SELECT id FROM listings WHERE listing_title = $1;',
                    [listing.listing_title]
                )

                if (listdListingExist.rowCount === 0) {
                    const newListdListing = await listdClient.query(
                        `
                        INSERT INTO listings (
                            agent_id,
                            listing_title,
                            listing_url,
                            listing_type_id,
                            sub_category,
                            property_status_id,
                            slug,
                            price,
                            price_formatted,
                            price_for_rent_per_sqm,
                            price_for_sale_per_sqm,
                            price_for_rent_per_sqm_formatted,
                            price_for_sale_per_sqm_formatted,
                            latitude_in_text,
                            longitude_in_text,
                            description
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                        RETURNING id;
                    `,
                        [
                            agentId,
                            listing.listing_title,
                            listing.listing_url,
                            listing.listing_type_id,
                            listing.sub_category,
                            listing.property_status_id,
                            listing.slug,
                            listing.price,
                            listing.price_formatted,
                            listing.price_for_rent_per_sqm,
                            listing.price_for_sale_per_sqm,
                            listing.price_for_rent_per_sqm_formatted,
                            listing.price_for_sale_per_sqm_formatted,
                            listing.latitude_in_text,
                            listing.longitude_in_text,
                            listing.description,
                        ]
                    )

                    const listdNewProperty = await listdClient.query(
                        `
                        INSERT INTO properties (
                            listing_id,
                            property_type_id,
                            building_name,
                            subdivision_name,
                            floor_area,
                            lot_area,
                            building_size,
                            bedrooms,
                            bathrooms,
                            parking_space,
                            city_id,
                            area,
                            address,
                            features,
                            main_image_url,
                            project_name
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                        RETURNING id;
                    `,
                        [
                            newListdListing.rows[0].id,
                            listing.property_type_id,
                            listing.building_name,
                            listing.subdivision_name,
                            listing.floor_area,
                            listing.lot_area,
                            listing.building_size,
                            listing.bedrooms,
                            listing.bathrooms,
                            listing.parking_space,
                            listdCity.rows[0].id,
                            listing.area,
                            listing.address,
                            listing.features,
                            listing.main_image_url,
                            listing.project_name,
                        ]
                    )

                    if (izziPropertyImages.rowCount) {
                        izziPropertyImages.rows.forEach(async (image) => {
                            await listdClient.query(
                                'INSERT INTO property_images (url, property_id) VALUES ($1, $2);',
                                [image.url, listdNewProperty.rows[0].id]
                            )
                        })
                    }
                }
                await listdClient.query('COMMIT')

                await izziClient.query(
                    'UPDATE FROM listing SET migrated_to_listd = true WHERE id = $1',
                    [listing.id]
                )
            }
        })
    } catch (error) {
        await listdClient.query('ROLLBACK')
        context.error(error?.message || "Something wen't wrong.")
    } finally {
        izziPool.end()
        listdPool.end()
    }
}

app.timer('migrate-data-izzi-to-listd', {
    schedule: '0 * * * * *',
    handler: migrateDataIzziToListd,
})
