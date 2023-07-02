import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import joi from 'joi';
import cors from 'cors';
import dayjs from 'dayjs';
import { stripHtml } from 'string-strip-html';


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
    name: joi.string().required(),
})

const msgSchema = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.valid('message', 'private_message').required(),
    from: joi.required(),
    time: joi.any()
})

app.post('/participants', async (req, res) => {
    let {name} = req.body;
    const validation = userSchema.validate(req.body, {abortEarly: false});
    name = stripHtml(name).result.trim();

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
});

app.post('/messages', async (req, res) => {
    let {to, text, type} = req.body;
    to = stripHtml(to).result.trim();
    text = stripHtml(text).result.trim();
    type = stripHtml(type).result.trim();
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
});

app.get('/messages', async (req, res) => {
    const user = req.headers.user;
    const online = await db.collection('participants').findOne({name: user});
    let messages = await db.collection('messages').find({$or: [{to: "Todos"}, {to: user}, {from: user}]}).toArray();
    let {limit} = req.query;
    
    messages = messages.reverse();
    try {
        if (!online) {
            return res.status(422).send('O usuário não está on-line');
        }

        if (limit === undefined || limit === null) {
            res.status(200).send(messages);
        } else if (limit || limit === 0 || isNaN(limit)) {
            if (limit === 0 || limit < 0 || isNaN(limit)) {
                return res.status(422).send('O valor de limit é inválido')
            } 
            if (limit >= messages.length) {
                return res.status(200).send(messages);
            }
            messages = messages.slice(0, limit);
            return res.status(200).send(messages);
        }
    } catch (err) {
        return res.status(500).send(err.message);
    }
});

app.post('/status', async (req, res) => {
    const user = req.headers.user;
    const online = await db.collection('participants').findOne({name: user});

    try {
        if (!user || !online) {
            return res.status(404);
        }
        await db.collection('participants').findOneAndUpdate({name: user}, {$set: {lastStatus: Date.now()}});
        res.sendStatus(200);
    } catch (err) {
        return res.status(500).send(err.message);
    }
});

app.delete('/messages/:ID_DA_MENSAGEM', async (req, res) => {
    const user = req.headers.user;
    let id = req.params.ID_DA_MENSAGEM;
    let toDelete = await db.collection('messages').findOne({_id: new ObjectId(id)});

    try {
        if (!toDelete) {
            return res.sendStatus(404);
        }
        
        if (toDelete.from !== user || toDelete.type === 'status') {
            return res.sendStatus(401);
        }

        await db.collection('messages').deleteOne({_id: new ObjectId(id)});

        res.status(200).send('Mensagem deletada com sucesso');
    } catch (err) {
        res.status(500).send(err.message);
    }

})

app.put('/messages/:ID_DA_MENSAGEM', async (req, res) => {
    const user = req.headers.user;
    let {to, text, type} = req.body;
    to = stripHtml(to).result.trim();
    text = stripHtml(text).result.trim();
    type = stripHtml(type).result.trim();
    let online = await db.collection('participants').findOne({name: user});
    let newMessage = {
        to,
        text,
        type,
        from: user
    }
    const validation = msgSchema.validate(newMessage, {abortEarly: false});
    let id = req.params.ID_DA_MENSAGEM;
    let toChange = await db.collection('messages').findOne({_id: new ObjectId(id)});


    try {
        if (!online) {
            return res.sendStatus(422);
        }

        if (validation.error) {
            const errors = validation.error.details.map(detail => detail.message);
            return res.status(422).send(errors);
        }

        if (!toChange) {
            return res.sendStatus(404);
        }

        if (toChange.from !== user) {
            return res.sendStatus(401);
        }

        let result = await db.collection('messages').updateOne({_id: new ObjectId(id)}, {$set: newMessage});
        res.sendStatus(200);

        if (result.matchedCount === 0) {
            return res.sendStatus(404);
        }

    } catch (err) {
        res.status(500).send(err.message);
    }
})

setInterval( async () => {
    const time = Date.now() - 10000;
    let users = await db.collection('participants').find({lastStatus: {$lt: time}}).toArray();

    try {
        users.forEach(async user => {
            try {
                await db.collection('participants').deleteOne({_id: new ObjectId(user._id)});
                const exitMsg = {
                    from: user.name,
                    to: 'Todos',
                    text: 'sai da sala...',
                    type: 'status',
                    time: timeNow
                }
                await db.collection('messages').insertOne(exitMsg);
            } catch (err) {
                res.status(500).send(err.message);
            }
        })
    } catch (err) {
        res.status(500).send(err.message);
    }
}, 15000);

app.listen(5000);