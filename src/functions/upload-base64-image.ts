import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions'
import {
    BlobServiceClient,
    StorageSharedKeyCredential,
} from '@azure/storage-blob'
import { Base64 } from 'js-base64'
import tinify from 'tinify'
import { z } from 'zod'

const querySchema = z.object({
    base64: z.string().refine((arg) => {
        const base64 = arg.replace('data:image/jpeg;base64,', '').trim()
        return Base64.isValid(base64)
    }),
})

export async function uploadBase64Image(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    try {
        const parsedBody = await querySchema.safeParseAsync(
            await request.json()
        )

        if (parsedBody.success === false) {
            const error = parsedBody.error.issues[0]

            return {
                jsonBody: {
                    message: `[${error.path}]: ${error.message}`.toLowerCase(),
                },
                status: 400,
            }
        }

        tinify.key = process.env['TINYFY_API_KEY']
        const account = 'izziassets'
        const container = 'images'
        const blobUrl = `https://${account}.blob.core.windows.net`
        const sharedKeyCredential = new StorageSharedKeyCredential(
            account,
            process.env['AZURE_BLOB_STORAGE_SHARED_KEY']
        )

        const blobServiceClient = new BlobServiceClient(
            blobUrl,
            sharedKeyCredential
        )

        const containerClient = blobServiceClient.getContainerClient(container)

        const matches = parsedBody.data.base64.match(
            /^data:([A-Za-z-+\/]+);base64,(.+)$/
        )

        if (matches === null) {
            return {
                jsonBody: {
                    message:
                        'The provided string does not contain Base64 data.',
                },
                status: 400,
            }
        }

        const mimeType = matches[1]
        const base64Data = matches[2]
        const buffer = Buffer.from(base64Data, 'base64')

        const resultData = await compressImage(buffer)
        const blobName = new Date().getTime() + extractFileExtension(mimeType)
        const blockBlobClient = containerClient.getBlockBlobClient(blobName)
        await blockBlobClient.upload(resultData, resultData.byteLength, {
            blobHTTPHeaders: {
                blobContentType: mimeType,
            },
        })

        return {
            jsonBody: {
                blobUrl: `${blobUrl}/${container}/${blobName}`,
            },
            status: 200,
        }
    } catch (error) {
        context.error(error)
        return {
            jsonBody: {
                message: 'Something went wrong' || error?.message,
            },
            status: 500,
        }
    }
}

function extractFileExtension(mimeType: string): string | null {
    const regex = /\/([a-zA-Z0-9]+)$/
    const match = mimeType.match(regex)
    if (match && match[1]) {
        return '.' + match[1]
    } else {
        return null
    }
}

async function compressImage(buffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        tinify.fromBuffer(buffer).toBuffer((err, resultData) => {
            if (err) {
                reject(err)
            } else {
                resolve(Buffer.from(resultData))
            }
        })
    })
}

app.http('upload-base64-image', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: uploadBase64Image,
})
