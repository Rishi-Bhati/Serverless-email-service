"""Send one email. Reads UNSENT_BASE_URL, UNSENT_API_KEY and UNSENT_API_SECRET.

    python examples/basic.py
"""

from unsent import Unsent


def main() -> None:
    unsent = Unsent()

    result = unsent.send(
        to="customer@example.com",
        subject="Welcome!",
        html="<h1>Hello</h1><p>Your account is ready.</p>",
        text="Hello, your account is ready.",
    )

    print("queued as", result.id, "via", result.target_provider or "the default provider")


if __name__ == "__main__":
    main()
