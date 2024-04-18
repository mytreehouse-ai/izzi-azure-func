import * as rd from 'redis'

export async function redis(options: {
    cacheHostName: string
    cachePassword: string
}) {
    const { cacheHostName, cachePassword } = options

    if (!cacheHostName || !cachePassword) {
        throw Error('Provide cache hostname and cache password.')
    }

    try {
        const cacheConnection = rd.createClient({
            url: `rediss://${cacheHostName}:6380`,
            password: cachePassword,
        })

        await cacheConnection.connect()

        return cacheConnection
    } catch (error) {
        throw Error(
            error?.message ||
                "Something wen't wrong during redis connection attemp."
        )
    }
}
