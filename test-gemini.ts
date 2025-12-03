import { generateObject } from 'ai'
import { z } from 'zod'

async function testGeminiAuth() {
  console.log('=== Gemini API Test ===')
  console.log('Node env vars check:')
  console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✓ SET' : '✗ NOT SET')
  console.log('GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✓ SET' : '✗ NOT SET')
  
  try {
    console.log('\n--- Testing simple text generation (no image) ---')
    const { object } = await generateObject({
      model: 'google/gemini-2.5-flash',
      schema: z.object({
        text: z.string(),
      }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Say "hello"',
            },
          ],
        },
      ],
    })
    console.log('✓ Text generation OK:', object)
  } catch (error: any) {
    console.error('✗ Text generation FAILED')
    console.error('Error message:', error.message)
    console.error('Error code:', error.code)
    console.error('Error status:', error.status)
    if (error.response) {
      console.error('Response status:', error.response.status)
      try {
        console.error('Response body:', await error.response.text())
      } catch {
        console.error('Response (non-text):', error.response)
      }
    }
    console.error('Full error:', JSON.stringify(error, null, 2))
  }
}

testGeminiAuth().catch(console.error)
