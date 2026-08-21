import httpx
import base64

API = "http://localhost:1184/api"

def main():
    with httpx.Client() as client:
        res = client.post(f"{API}/auth/otp/request", json={"phone": "01711000001", "purpose": "LOGIN"})
        print("OTP Request:", res.status_code)
        
        res = client.post(f"{API}/auth/otp/verify", json={"phone": "01711000001", "code": "000000"})
        print("OTP Verify:", res.status_code)
        token = res.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        res = client.post(f"{API}/cbc/sessions", headers=headers)
        print("Create Session:", res.status_code, res.text)
        session_id = res.json()["id"]
        
        dummy_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff\xff\x00\x05\xfe\x02\xfe\xa4\xce\x1b\xc3\x00\x00\x00\x00IEND\xaeB\x82'
        b64_image = base64.b64encode(dummy_png).decode("utf-8")
        
        print("Uploading dummy image (OpenAI should flag as invalid)...")
        res = client.post(f"{API}/cbc/sessions/{session_id}/upload", headers=headers, json={
            "image": f"data:image/png;base64,{b64_image}"
        }, timeout=30.0)
        print("Upload Image:", res.status_code)
        print(res.json())

if __name__ == '__main__':
    main()
