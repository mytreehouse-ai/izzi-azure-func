import { Pool } from 'pg'

export async function postgres(options: {
    host: string
    port: number
    user: string
    password: string
    database: string
    ssl?: boolean
}) {
    const { host, port, user, password, database, ssl = true } = options

    const pool = new Pool({
        max: 300,
        connectionTimeoutMillis: 5000,
        host,
        port,
        user,
        password,
        database,
        ssl,
    })

    return pool
}
