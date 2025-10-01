/**
 * این تابع به عنوان یک واسط (Proxy) عمل می کند.
 * درخواست JSON را از مرورگر کاربر دریافت کرده و آن را به API گوگل می فرستد.
 * این کار باعث می شود کلید API پنهان بماند و مشکل فیلترینگ برای کاربر حل شود.
 */
exports.handler = async (event) => {
    // 1. اطمینان از اینکه درخواست از نوع POST است
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 2. بازیابی کلید API از متغیرهای محیطی Netlify (امن ترین روش)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY is not set in Netlify environment variables.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: "API key is missing on the server." }) 
        };
    }

    // 3. تنظیمات API گوگل
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
        // 4. دریافت محتوای درخواست از مرورگر کاربر
        const payload = JSON.parse(event.body);

        // 5. ارسال درخواست به API گوگل
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                // نیازی به Authorization header نیست، کلید در URL است
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        // 6. برگرداندن پاسخ گوگل به مرورگر کاربر
        return {
            statusCode: response.status,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error("Error during API call:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to communicate with the Gemini API." })
        };
    }
};
