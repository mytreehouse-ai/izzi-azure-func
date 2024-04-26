import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import { DefaultAzureCredential } from '@azure/identity'
import { BlobServiceClient } from '@azure/storage-blob'

export async function uploadImage(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const account = 'izziassets'
    const defaultAzureCredential = new DefaultAzureCredential()

    const blobServiceClient = new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        defaultAzureCredential
    )

    const containerClient = blobServiceClient.getContainerClient('images')

    const content = 'Hello world!'
    const blobName = 'newblob' + new Date().getTime()
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)
    const uploadBlobResponse = await blockBlobClient.upload(
        content,
        content.length
    )
    console.log(
        `Upload block blob ${blobName} successfully`,
        uploadBlobResponse.requestId
    )

    context.log(`Http function processed request for url "${request.url}"`)

    const name = request.query.get('name') || (await request.text()) || 'world'

    return { body: `Hello, ${name}!` }
}

app.http('upload-image', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: uploadImage,
})
