import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'

export async function scraperApiWebhook(
    request: HttpRequest,
    _context: InvocationContext
): Promise<HttpResponseInit> {
    const body = await request.json()

    return { jsonBody: { body } }
}

app.http('scraper-api-webhook', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: scraperApiWebhook,
})
