import { Unsent, UnsentError } from 'unsent-sdk';

// Reads UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET from the environment.
const unsent = new Unsent();

try {
  const { id } = await unsent.send({
    from: 'Acme <hello@acme.com>', // must be a sender configured in your Unsent dashboard
    to: 'customer@example.com',
    subject: 'Welcome to Acme',
    html: '<h1>Welcome!</h1><p>Your account is ready.</p>',
    text: 'Welcome! Your account is ready.',
    idempotencyKey: 'welcome:customer-42', // optional: makes "send once" survive your own retries too
  });
  console.log('queued as', id);

  // Optional: wait until it has actually been delivered.
  const email = await unsent.emails.wait(id);
  console.log(email.status, email.providerUsed);
} catch (err) {
  if (err instanceof UnsentError) {
    console.error(`${err.code}: ${err.message}`);
  } else {
    throw err;
  }
}
