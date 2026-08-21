import httpx

API = "http://localhost:1184/api"
res = httpx.post(f"{API}/auth/otp/request", json={"phone": "01711000005", "purpose": "LOGIN"})
print(res.json())
