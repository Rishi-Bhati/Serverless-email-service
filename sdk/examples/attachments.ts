import { Unsent } from 'unsent-sdk';
import { attachmentFromFile } from 'unsent-sdk/node';

const unsent = new Unsent();

await unsent.send({
  to: 'customer@example.com',
  subject: 'Your invoice',
  html: '<p>Invoice attached.</p>',
  attachments: [
    await attachmentFromFile('./invoice.pdf'), // reads the file, sets name + MIME type
    { filename: 'notes.txt', content: new TextEncoder().encode('Thanks for your order!'), contentType: 'text/plain' },
  ],
});
