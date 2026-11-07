// app/api/contact/route.ts
import { Unsent, UnsentError } from 'unsent-sdk';

// Create the client once per server instance, never in client components.
const unsent = new Unsent({
  baseUrl: process.env.UNSENT_BASE_URL,
  apiKey: process.env.UNSENT_API_KEY,
  apiSecret: process.env.UNSENT_API_SECRET,
});

export async function POST(request: Request) {
  const { email, message } = (await request.json()) as { email: string; message: string };

  try {
    const result = await unsent.send({
      to: 'support@acme.com',
      subject: `Contact form: ${email}`,
      text: message,
    });
    return Response.json({ ok: true, id: result.id }, { status: 202 });
  } catch (err) {
    if (err instanceof UnsentError) {
      console.error('unsent failed', err.code, err.message);
      return Response.json({ ok: false, error: 'Could not send message' }, { status: 502 });
    }
    throw err;
  }
}
