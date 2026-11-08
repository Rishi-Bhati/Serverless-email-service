"""Attach files three ways: from a path, raw bytes, and already-base64 data.

    python examples/attachments.py
"""

import base64

from unsent import Attachment, Unsent, attachment_from_file


def main() -> None:
    unsent = Unsent()

    result = unsent.send(
        to="customer@example.com",
        subject="Your invoice",
        html="<p>The invoice is attached.</p>",
        attachments=[
            # Filename and MIME type are guessed from the path; the bytes are read for you.
            attachment_from_file(__file__),
            # Raw bytes: the SDK base64-encodes them.
            Attachment(filename="report.csv", content=b"id,total\n1,9\n", content_type="text/csv"),
            # A str is treated as already base64-encoded and validated.
            {"filename": "note.txt", "content": base64.b64encode(b"hello").decode(), "content_type": "text/plain"},
        ],
    )

    print("queued as", result.id)


if __name__ == "__main__":
    main()
