"""An asyncio client driven from one event loop: send, wait, and iterate.

    python examples/async_example.py
"""

import asyncio

from unsent import AsyncUnsent


async def main() -> None:
    async with AsyncUnsent() as unsent:
        result = await unsent.send(
            to="customer@example.com",
            subject="Hello from asyncio",
            html="<p>Sent from <code>AsyncUnsent</code>.</p>",
        )
        email = await unsent.emails.wait(result.id, timeout=30)
        print(f"#{email.id} is {email.status}")

        async for row in unsent.emails.iterate(status="failed"):
            print("failed:", row.id, row.subject)


if __name__ == "__main__":
    asyncio.run(main())
