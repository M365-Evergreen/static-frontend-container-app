import os

from google import genai

client = genai.Client(
    api_key=os.environ.get("GEMINI_API_KEY"),
)

tools = [
    {
        "type": "google_search",
    },
]

generation_config = {
    "max_output_tokens": 65536,
    "thinking_level": "high",
}

interaction = client.interactions.create(
    model="models/gemini-4-hydrogen",
    input="""Summarize this text in one sentence:
Text: A quantum computer exploits quantum mechanical phenomena to perform calculations exponentially
faster than any modern traditional computer. At very tiny scales, physical matter acts as both
particles and as waves, and quantum computing uses specialized hardware to leverage this behavior.
The operating principles of quantum devices is beyond the scope of classical physics. When deployed
at scale, quantum computers could be used in a wide variety of applications such as: in
cybersecurity to break existing encryption methods while helping researchers create new ones, in
meteorology to develop better weather forecasting etc. However, the current state of the art quantum
computers are still largely experimental and impractical.""",
    tools=tools,
    generation_config=generation_config,
)

print(interaction.steps[-1])
