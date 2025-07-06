const express = require('express');
const Redis = require('ioredis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const FormData = require('form-data');

const app = express();


const PORT = process.env.PORT || 3000;


/**
 * Simple logger middleware for Express requests.
 */
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.ip}`);
    next();
});

/**
 * Endpoint to list available APIs, specifically for Home Assistant.
 */
app.get('/apis', (req, res) => {
    let apiEndpoints = { message: "Available API Endpoints", endpoints: [] };
    try {
        const apiJsonPath = path.join(__dirname, 'apis.json');
        const rawData = fs.readFileSync(apiJsonPath, 'utf8');
        apiEndpoints = JSON.parse(rawData);
        console.log('Successfully loaded API endpoints from apis.json');
    } catch (error) {
        console.error('Error loading apis.json:', error.message);
    }

    const processedEndpoints = apiEndpoints.endpoints.map(endpoint => {
        return {
            ...endpoint,
            url: endpoint.url.replace('[YOUR_HOST]', req.headers.host)
        };
    });
    res.json({
        message: apiEndpoints.message,
        endpoints: processedEndpoints
    });
});


app.get('/docs', (req, res) => {
    let docs = { message: "Available Documents", documentations: [] };
    try {
        const apiJsonPath = path.join(__dirname, 'docs.json');
        const rawData = fs.readFileSync(apiJsonPath, 'utf8');
        docs2 = JSON.parse(rawData);
        docs.documentations = docs2;
    } catch (error) {
    }

    res.json(docs);
});


app.use('/kmb', require('./kmb/index'));
const OpenAI = require('openai');

app.get('/weather/hk', async (req, res) => {
    const weatherUrls = [
        'https://rss.weather.gov.hk/rss/WeatherWarningSummaryv2_uc.xml',
        'https://rss.weather.gov.hk/rss/LocalWeatherForecast_uc.xml',
        'https://rss.weather.gov.hk/rss/SeveralDaysWeatherForecast_uc.xml'
    ];

    try {
        const responses = await Promise.all(
            weatherUrls.map(url => axios.get(url))
        );

        const cleanHtml = (html) => {
            if (!html) return '';
            const $ = cheerio.load(html);
            return $.text();
        };

        const removeUnwantedWhitespace = (text) => {
            if (!text) return '';
            // Remove space between Chinese characters, then remove excessive general whitespace.
            return text.replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, '$1').replace(/\s+/g, ' ').trim();
        };

        const weatherData = responses.map((response, index) => {
            const $ = cheerio.load(response.data, { xmlMode: true });
            let description = $('item description').text().trim() || $('item title').text().trim() || '';

            // if (index === 2) { // Apply cleaning specifically for severalDaysWeatherForecast
            description = cleanHtml(description);
            description = removeUnwantedWhitespace(description);
            // }
            return description;
        });

        res.json({
            weatherWarningSummary: weatherData[0],
            localWeatherForecast: weatherData[1],
            severalDaysWeatherForecast: weatherData[2]
        });
    } catch (error) {
        console.error('Error fetching HK weather data:', error.message);
        res.status(500).json({ error: 'Failed to fetch HK weather data', details: error.message });
    }
});
app.get('/weather/hk/radar', async (req, res) => {
    try {
        const hkoRadarJsonUrl = 'https://www.hko.gov.hk/wxinfo/radars/temp_json/iradar_img.json';
        const radarData = (await axios.get(hkoRadarJsonUrl)).data;


        // Allow selecting range via query param (e.g., ?range=2), default to 2 (64km)
        const requestedRange = req.query.range || '2';
        const rangeKey = `range${requestedRange}`;
        if (!radarData?.radar?.[rangeKey]?.image) {
            const availableRanges = Object.keys(radarData?.radar || {}).filter(k => k.startsWith('range')).map(k => k.replace('range', ''));
            return res.status(404).json({
                error: `Invalid or missing radar data for '${rangeKey}'.`,
                message: `Please provide a 'range' query parameter. Available ranges are: ${availableRanges.join(', ') || 'none'}.`
            });
        }

        const rangeImages = radarData.radar[rangeKey].image;

        if (!Array.isArray(rangeImages) || rangeImages.length === 0) {
            return res.status(404).json({ error: `No radar images found for ${rangeKey}.` });
        }

        // The image string is like: picture[2][19]="rad_064_png/2d064iradar_...jpg";
        // We need to extract the path inside the quotes.
        const lastImageString = rangeImages[rangeImages.length - 1];
        const filenameMatch = lastImageString.match(/"(.*?)"/);

        if (!filenameMatch || filenameMatch.length < 2) {
            return res.status(500).json({ error: 'Could not parse radar image filename.' });
        }

        const radarImageRelativePath = filenameMatch[1];
        const fullImageUrl = `https://www.hko.gov.hk/wxinfo/radars/${radarImageRelativePath}`;

        // Download the image
        const imageResponse = await axios.get(fullImageUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        console.log(`Latest radar image for ${rangeKey}: ${fullImageUrl}`);

        // Send photo to Telegram (async)
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_GROUP_ID) {
            const telegramApiBaseUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
            const photoUrl = `${telegramApiBaseUrl}/sendPhoto`;
            const photoFormData = new FormData();
            photoFormData.append('chat_id', process.env.TELEGRAM_GROUP_ID);
            photoFormData.append('photo', imageBuffer, { filename: 'radar.jpg', contentType: 'image/jpeg' });
            photoFormData.append('caption', `HKO Radar Image (Range: ${requestedRange})`);
            try {
                axios.post(photoUrl, photoFormData, {
                    headers: photoFormData.getHeaders()
                }).then(() => console.log('Radar image sent to Telegram successfully.'))
                    .catch(telegramError => console.error('Error sending radar image to Telegram:', telegramError.response ? telegramError.response.data : telegramError.message));
            } catch (telegramError) {
                console.error('Error initiating Telegram photo send:', telegramError.message);
            }
        }

        // Let LLM analyze
        const openai = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY, // Replace with your actual API key environment variable
            baseURL: "https://openrouter.ai/api/v1",
        });

        const chatCompletion = await openai.chat.completions.create({
            model: "google/gemini-2.5-pro",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe the Current Weather Conditions from this radar image. No need to describe legends." },
                        { type: "image_url", image_url: { url: fullImageUrl } },
                    ],
                },
            ],
        });

        let weatherDescription = chatCompletion.choices[0].message.content;

        // Return result to client
        res.json({
            range: requestedRange,
            radarImageUrl: fullImageUrl,
            weatherDescription: weatherDescription,
        });

        console.log({ weatherDescription })

        // Send description to Telegram (async)
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_GROUP_ID) {
            const telegramApiBaseUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
            const messageUrl = `${telegramApiBaseUrl}/sendMessage`;

            const textMessage = `Current Weather Conditions:\n\n${weatherDescription}`;
            try {
                axios.post(messageUrl, {
                    chat_id: process.env.TELEGRAM_GROUP_ID,
                    text: textMessage
                }).then(() => console.log('Weather description sent to Telegram successfully.'))
                    .catch(telegramError => console.error('Error sending weather description to Telegram:', telegramError.response ? telegramError.response.data : telegramError.message));
            } catch (telegramError) {
                console.error('Error initiating Telegram message send:', telegramError.message);
            }
        }

    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error("Failed to parse HKO response as JSON:", error.message);
            return res.status(500).json({ error: 'Failed to parse radar data from HKO', details: error.message });
        }
        console.error('Error fetching HKO radar image or describing it:', error.message);
        res.status(500).json({ error: 'Failed to process radar image', details: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
