import base64
import os
from pathlib import Path

import httpx

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = False


def media_data_url(kind, index, mime_types):
    for suffix, mime in mime_types.items():
        path = Path(f"{kind}_{index}{suffix}")
        if path.exists():
            return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    raise FileNotFoundError(f"Expected {kind}_{index} with suffix in {list(mime_types)}")


image_data_urls = [
    media_data_url(
        "image",
        i,
        {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"},
    )
    for i in [1]
]

headers = {
    "Authorization": f"Bearer {os.environ.get('MISTRAL_API_KEY') or os.environ.get('NVIDIA_API_KEY')}",
    "Accept": "text/event-stream" if stream else "application/json",
}

if not (os.environ.get("MISTRAL_API_KEY") or os.environ.get("NVIDIA_API_KEY")):
    raise RuntimeError("Set MISTRAL_API_KEY or NVIDIA_API_KEY before running this probe.")

payload = {
    "model": "mistralai/mistral-large-4-1t-a52b",
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Describe the color and shape on the left and on the right.",
                },
                {"type": "image_url", "image_url": {"url": image_data_urls[0]}},
            ],
        }
    ],
    "max_tokens": 4096,
    "stream": stream,
    "temperature": 0.5,
    "top_p": 1,
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "reasoning_effort": "high",
}

with httpx.Client(timeout=120) as client:
    response = client.post(invoke_url, headers=headers, json=payload)

    if stream:
        response.raise_for_status()
        print(response.text)
    else:
        print(response.status_code)
        print(response.json())
