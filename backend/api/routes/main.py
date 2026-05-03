import json
import os
import shutil
import tempfile
import warnings
import contextlib

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from groq import Groq
from langchain_opendataloader_pdf import OpenDataLoaderPDFLoader
from pydantic import BaseModel, Field

load_dotenv()
warnings.filterwarnings("ignore")

app = FastAPI(title="Invoice Extractor")
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


@app.get("/")
async def get_upload_page():
    """Serve the invoice upload page"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return FileResponse(os.path.join(current_dir, "index.html"), media_type="text/html")

SYSTEM_PROMPT = """You are an invoice data extractor. Extract invoice information and return ONLY a JSON object with exactly these keys:
- vendor_name: name of the vendor or seller
- vendor_address: full address of the vendor
- date: invoice date in YYYY-MM-DD format
- invoice_number: unique invoice identifier
- client: name of the client or buyer
- client_address: full address of the client
- description: description of goods or services
- amount: total amount as a number (no currency symbol)
- currency: three-letter ISO 4217 code (e.g. USD, SGD, EUR)

Return only these 9 keys, nothing else."""


class Invoice(BaseModel):
    vendor_name: str = Field(description="Name of the vendor or seller issuing the invoice")
    vendor_address: str = Field(description="Full address of the vendor")
    date: str = Field(description="Invoice date in ISO 8601 format (YYYY-MM-DD)")
    invoice_number: str = Field(description="Unique invoice identifier")
    client: str = Field(description="Name of the client or buyer being billed")
    client_address: str = Field(description="Full address of the client")
    description: str = Field(description="Description of goods or services provided")
    amount: float = Field(description="Total invoice amount as a numeric value")
    currency: str = Field(description="Three-letter ISO 4217 currency code, e.g. USD, SGD, EUR")


class InvoiceResult(BaseModel):
    filename: str
    invoice: Invoice | None = None
    error: str | None = None


def process_file(tmp_path: str) -> Invoice:
    loader = OpenDataLoaderPDFLoader(
        file_path=[tmp_path],
        format="text",
        split_pages=False,
    )
    with open(os.devnull, "w") as devnull, contextlib.redirect_stderr(devnull):
        docs = loader.load()

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Extract invoice data from:\n\n{docs[0].page_content}"},
        ],
    )
    data = json.loads(response.choices[0].message.content)
    return Invoice.model_validate(data)


@app.post("/extract-invoice", response_model=list[InvoiceResult])
async def extract_invoice(files: list[UploadFile] = File(...)) -> list[InvoiceResult]:
    results: list[InvoiceResult] = []
    tmp_dir = tempfile.mkdtemp()

    try:
        for file in files:
            if not file.filename or not file.filename.lower().endswith(".pdf"):
                results.append(InvoiceResult(filename=file.filename or "unknown", error="Only PDF files are supported"))
                continue

            tmp_path = os.path.join(tmp_dir, file.filename)
            with open(tmp_path, "wb") as f:
                shutil.copyfileobj(file.file, f)

            try:
                invoice = process_file(tmp_path)
                results.append(InvoiceResult(filename=file.filename, invoice=invoice))
            except Exception as e:
                results.append(InvoiceResult(filename=file.filename, error=str(e)))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return results
