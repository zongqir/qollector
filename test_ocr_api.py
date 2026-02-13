import requests
import base64
import json

# API 配置
API_KEY = "sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp"
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL = "Pro/Qwen/Qwen2-VL-7B-Instruct"

# 创建一个简单的测试图片（1x1 白色像素 PNG）
test_image_bytes = bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
])

# Base64 编码
image_base64 = base64.b64encode(test_image_bytes).decode('utf-8')
data_url = f"data:image/png;base64,{image_base64}"

# 构建请求
request_data = {
    "model": MODEL,
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "请识别图片中的所有文字，直接返回文字内容，不要添加任何解释或格式。如果图片中没有文字，返回空字符串。"
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": data_url
                    }
                }
            ]
        }
    ],
    "max_tokens": 2000,
    "temperature": 0.0
}

print(f"测试硅基流动 OCR API")
print(f"API URL: {BASE_URL}/chat/completions")
print(f"模型: {MODEL}")
print(f"图片大小: {len(test_image_bytes)} 字节")
print("-" * 50)

try:
    # 发送请求
    response = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json=request_data,
        timeout=30
    )

    print(f"响应状态码: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        print("\n✓ API 调用成功!")
        print(f"响应内容: {json.dumps(result, indent=2, ensure_ascii=False)}")

        if result.get('choices'):
            text = result['choices'][0]['message']['content']
            print(f"\n识别结果: {text}")
    else:
        print(f"\n✗ API 调用失败")
        print(f"错误信息: {response.text}")

except Exception as e:
    print(f"\n✗ 发生错误: {e}")
