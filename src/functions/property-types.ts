import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { z } from 'zod'
import slugify from 'slugify'
import { getPoolDb } from '../database/neon'

const createPropertyTypeSchema = z.object({
    propertyTypeName: z.string(),
})

export async function propertyTypes(
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

        if (requestMethod === 'GET') {
            const query = await client.query('SELECT * FROM property_type')

            return {
                jsonBody: {
                    data: query.rows,
                },
            }
        }

        if (requestMethod === 'POST') {
            const body = await request.json()

            const parsedBody =
                await createPropertyTypeSchema.safeParseAsync(body)

            if (!parsedBody.success) {
                return {
                    jsonBody: {
                        message: 'Invalid property type name.',
                    },
                    status: 400,
                }
            }

            const slug = slugify(
                parsedBody.data.propertyTypeName.toLowerCase(),
                '-'
            )

            const findOne = await client.query(
                `SELECT * FROM property_type WHERE name = $1`,
                [parsedBody.data.propertyTypeName]
            )

            if (findOne.rowCount) {
                return {
                    jsonBody: {
                        data: findOne.rows[0],
                    },
                }
            }

            const query = await client.query(
                'INSERT INTO property_type (name, slug) VALUES ($1, $2) RETURNING *',
                [parsedBody.data.propertyTypeName, slug]
            )

            return {
                jsonBody: {
                    data: query.rows[0],
                },
            }
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

app.http('property-types', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: propertyTypes,
})
