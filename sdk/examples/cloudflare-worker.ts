import { Unsent } from 'unsent-sdk';

// Secrets: wrangler secret put UNSENT_API_KEY / UNSENT_API_SECRET; plain var: UNSENT_BASE_URL
interface Env {
  UNSENT_BASE_URL: string;
  UNSENT_API_KEY: string;
  UNSENT_API_SECRET: string;
}

export default {
  async fetch(_request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const unsent = Unsent.fromEnv(env as unknown as Record<string, string>);

    // Don't make the visitor wait for the email request.
    ctx.waitUntil(unsent.send({ to: 'ops@acme.com', subject: 'Worker ran', text: 'It works.' }));
    return new Response('ok');
  },
};
