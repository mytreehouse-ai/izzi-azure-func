import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { getPoolDb } from '../database/neon'
import { redis } from '../database/redis'

export async function listingCities(
    _request: HttpRequest,
    context: InvocationContext
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

    const { client, pool } = await getPoolDb(databaseUrl)

    try {
        const redisCredentials = {
            cacheHostName: process.env['AZURE_REDIS_URL'],
            cachePassword: process.env['AZURE_REDIS_PASSOWRD'],
        }

        const rd = await redis(redisCredentials)

        const cities = await rd.get('cities')

        if (cities) {
            return {
                jsonBody: {
                    data: JSON.parse(cities),
                },
            }
        }

        const query = await client.query(
            `SELECT
              city.id,
              city.name,
              region.name AS region
            FROM cities AS city
            INNER JOIN regions AS region ON region.region_id = city.region_id 
            ORDER BY city.name ASC`
        )

        await rd.set('cities', JSON.stringify(query.rows), { EX: 60 * 60 * 4 })

        return {
            jsonBody: {
                data: query.rows,
            },
        }
    } catch (error) {
        context.error(error)
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

app.http('listing-cities', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: listingCities,
})
