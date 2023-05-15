import express, { Router } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

import MarkdownIt from 'markdown-it';
import axios from 'axios';
import fs from 'fs/promises';
import delay from 'delay';

const app = express();
const md = new MarkdownIt();
const keyModels = new Map();

app.set('trust proxy', true);

app.use(cors());
app.use(bodyParser.json());

const apiRouter = Router();

app.use('/api', (req, _res, next) => {
    req.key = String(req.query?.key ?? '0000000000');
    console.log(`${req.method} ${req.url}`);
    next();
}, apiRouter);

apiRouter.get('/modules', (req, res) => {
    res.json({
        modules: ['sd'],
    });
});

apiRouter.get('/image/samplers', (req, res) => {
    res.json({
        samplers: ['k_euler', 'k_euler_a', 'k_dpm_2_a', 'k_dpmpp_2s_a', 'k_dpmpp_sde', 'DDIM'],
    });
});

apiRouter.get('/image/model', async (req, res) => {
    res.json({
        model: keyModels.get(req.key) ?? 'Anything Diffusion',
    });
});

apiRouter.post('/image/model', async (req, res) => {
    keyModels.set(req.key, req.body.model);
    res.json({
        model: req.body.model,
    });
});

apiRouter.get('/image/models', async (req, res) => {
    const { data: models } = await axios.get(`https://aihorde.net/api/v2/status/models?type=image`);

    res.json({
        models: models.map(m => m.name).filter(m => !m.includes('inpainting')),
    });
});

apiRouter.post('/image', async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.flushHeaders();
    const {
        prompt, prompt_prefix, negative_prompt,
        sampler, steps, scale, width, height,
    } = req.body;

    const hordeData = {
        prompt: `${prompt_prefix}${prompt}###${negative_prompt}`,
        params: {
            steps: steps,
            n: 1,
            sampler_name: sampler,
            width, height,
            cfg_scale: scale,
            seed_variation: 1,
            seed: "",
            karras: sampler !== 'DDIM',
            denoising_strength: 0.5,
            tiling: false,
            hires_fix: false,
            clip_skip: 2,
            post_processing: []
        },
        nsfw: true,
        censor_nsfw: false,
        trusted_workers: false,
        models: [keyModels.get(req.key) ?? 'Anything Diffusion'],
        shared: false,
        r2: false,
        jobId: "",
        index: 0,
        gathered: false,
        failed: false
    };

    const hordeHeaders = {
        'apikey': req.key,
    };

    console.log(hordeData, hordeHeaders);

    let image = '';
    try {

        const { data: hordeJob } = await axios.post('https://aihorde.net/api/v2/generate/async', hordeData, { headers: hordeHeaders });

        console.log(hordeJob);

        while (true) {
            await delay(1000);
            const { data: hordeCheck } = await axios.get(`https://aihorde.net/api/v2/generate/check/${hordeJob.id}`);

            console.log(hordeCheck);

            if (hordeCheck.done) {
                const { data: hordeResult } = await axios.get(`https://aihorde.net/api/v2/generate/status/${hordeJob.id}`);

                console.log(hordeResult);

                image = hordeResult.generations[0]?.img;
                break;
            }
        }
    } catch (e) {
        console.error(e);
    }

    res.end(JSON.stringify({
        image,
    }));
});

app.get('/', async (req, res) => {
    const file = await fs.readFile('./README.md', 'utf-8');
    const html = md.render(file);

    const host = req.hostname ?? 'localhost';

    res.set('Content-Type', 'text/html');
    res.end(`
    <html>
        <head>
            <title>SD Horde Imitator</title>
            <style>
                body {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    gap: 10px;
                }

                p {
                    margin: 0;
                }
            </style>
        </head>
        <body>
            ${html.replace('${host}', host)}
        </body>
    </html>
    `);
});

app.listen(process.env.PORT || 7860);