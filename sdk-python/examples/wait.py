"""Wait for delivery, then inspect the email. Also lists recent failures.

    python examples/wait.py
"""

from unsent import Unsent


def main() -> None:
    unsent = Unsent()

    result = unsent.send(to="customer@example.com", subject="Receipt", text="Thanks!")
    email = unsent.emails.wait(result.id, timeout=60)

    if email.status == "sent":
        print(f"#{email.id} delivered via {email.provider_used}")
    else:
        print(f"#{email.id} failed after {email.attempts} attempts: {email.error}")
        for attempt in email.failover_history:
            print("  -", attempt.provider, attempt.error)

    print("recent failures:")
    for row in unsent.emails.iterate(status="failed"):
        print(f"  #{row.id} {row.subject!r} {row.status}")


if __name__ == "__main__":
    main()
