import express from 'express';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import joi from 'joi';
import cors from 'cors';
import dayjs from 'dayjs';

const app = express();
app.use(express.json());
app.use(cors());

dotenv.config();

const mongoClient = new MongoClient(process.env.DATABASE_URL);
let db;

mongoClient.connect()
.then(() => db = mongoClient.db())
.catch((err) => console.log(err.message));

const timeNow = dayjs().format('HH:mm:ss');

const userSchema = joi.object({
    name: joi.string().required()
})

const msgSchema = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.valid('message', 'private_message').required(),
    from: joi.required(),
    time: joi.any()
})

app.post('/participants', async (req, res) => {
    const {name} = req.body;
    const validation = userSchema.validate(req.body, {abortEarly: false});

    try {
        const usedName = await db.collection("participants").findOne({name})
        const message = { 
            from: name,
            to: 'Todos',
            text: 'entra na sala...',
            type: 'status',
            time: timeNow
            }

        if(usedName) {
            return res.status(409).send('Nome já cadastrado');
        }

        if (validation.error) {
            const errors = validation.error.details.map(detail => detail.message);
            return res.status(422).send(errors);
        } else {
            await db.collection("participants").insertOne({
                name: name,
                lastStatus: Date.now()
            });
            await db.collection("messages").insertOne(message);
            res.sendStatus(201);
        }
    } catch (err) {
        return res.sendStatus(500);
    }
})

app.get('/participants', async (req, res) => {
    const participants = await db.collection("participants").find().toArray();
    
    try {
        res.send(participants);
    } catch (err) {
        console.log(err.message)
    }
})

app.post('/messages', async (req, res) => {
    let {to, text, type} = req.body;
    const user = req.headers.user;
    const online = await db.collection('participants').findOne({name: user});
    const message = {
        to,
        text,
        type,
        from: user,
        time: timeNow
    }
    const validation = msgSchema.validate(message, {abortEarly: false});

    try {
        if (!online) {
            return res.status(422).send('Usuário não está on-line')
        }
        if(validation.error) {
            const errors = validation.error.details.map(detail => detail.message);
            return res.status(422).send(errors);
        } else {
            await db.collection('messages').insertOne(message);
            res.sendStatus(201);
        }
    } catch (err) {
        return res.status(500);
    }
})

app.listen(5000);