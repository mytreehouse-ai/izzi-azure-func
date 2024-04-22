import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { getPoolDb } from '../database/neon'

export async function listingTypes(
    _request: HttpRequest,
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
        const query = await client.query('SELECT * FROM listing_type')

        return {
            jsonBody: {
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
        await pool.end()
    }
}

app.http('listing-types', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: listingTypes,
})
