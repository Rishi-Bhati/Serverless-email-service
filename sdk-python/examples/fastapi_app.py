"""FastAPI integration: one shared AsyncUnsent owned by the app lifespan.

    pip install "unsent-sdk[fastapi]" uvicorn
    uvicorn examples.fastapi_app:app --reload
"""

from fastapi import FastAPI
from unsent.fastapi import UnsentDep, add_exception_handlers, lifespan

app = FastAPI(lifespan=lifespan())
add_exception_handlers(app)


@app.post("/welcome")
async def welcome(email: str, unsent: UnsentDep) -> dict:
    result = await unsent.send(to=email, subject="Welcome", text="Hi!")
    return {"id": result.id, "status": result.status}
