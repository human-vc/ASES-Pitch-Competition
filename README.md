Vigil

Detects coordinated astroturfing campaigns in federal public comments.

Demo (static)

    open demo.html

Dashboard (Next.js)

    cd demo
    npm install
    npm run dev

    Open localhost:3000/dashboard

Backend (Python pipeline)

    cd backend
    pip install -r requirements.txt
    python -m spacy download en_core_web_sm

    Set VOYAGE_API_KEY, ANTHROPIC_API_KEY, and REGULATIONS_GOV_API_KEY
    before running the pipeline. Pre-computed results ship in backend/data/.
