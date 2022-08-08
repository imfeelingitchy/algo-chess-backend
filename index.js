import { loadStdlib } from "@reach-sh/stdlib"
import { ALGO_WalletConnect } from "@reach-sh/stdlib";
import * as backend from './build/index.main.mjs';
import WalletConnect from "@walletconnect/client";
import QRCodeModal from "algorand-walletconnect-qrcode-modal"
import Axios from "axios";

import { createRequire } from "module";
const require = createRequire(import.meta.url)

const CONNECTOR = process.env.CONNECTOR
const ACCOUNT = process.env.ACCOUNT
const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS
const SECURE = process.env.SECURE
console.log("A" + process.cwd())

const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const mysql = require("mysql")
const cookieParser = require("cookie-parser")
const csrf = require("csurf")
const session = require("express-session")

const app = express()

const db = mysql.createPool({
    host: process.env.HOST,
    user: process.env.USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE
})

const stdlib = loadStdlib("ALGO")
stdlib.setWalletFallback(stdlib.walletFallback(
    {
        providerEnv: {
            ALGO_TOKEN: '',
            ALGO_SERVER: (CONNECTOR === "MAINNET") ? "https://mainnet-api.algonode.cloud" : "https://testnet-api.algonode.cloud",
            ALGO_PORT: '',
            ALGO_INDEXER_TOKEN: '',
            ALGO_INDEXER_SERVER: (CONNECTOR === "MAINNET") ? "https://mainnet-idx.algonode.cloud" : "https://testnet-idx.algonode.cloud",
            ALGO_INDEXER_PORT: '',
        }
    }
))

let adminAccount
stdlib.newAccountFromMnemonic(ACCOUNT)
.then((val) => {
    adminAccount = val
})

app.set("trust proxy", 1)
app.use(cookieParser())
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: false,
    cookie: {
      sameSite: "none",
      domain: process.env.ORIGIN,
      secure: true
    }
}))
app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    next();
})
app.use(cors({origin: process.env.ORIGIN, credentials: true}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))
app.use(csrf({cookie: {httpOnly: true, secure: (SECURE === "secure")}, ignoreMethods: ["HEAD", "OPTIONS"]}))

app.use(function (err, req, res, next) {
    if (err.code !== 'EBADCSRFTOKEN') {
        res.status(500)
        res.send("an error occured")
    }
    if (req.path !== "/api/getcsrftoken") {
        res.status(403)
        res.send("forbidden")
    } else {
        return next()
    }
})

app.get("/api/getcsrftoken", (req, res) => {
    res.send({csrfToken: req.csrfToken()})
})


app.get("/api/getexistinggame", (req, res) => {
    const selectQuery = "SELECT contract, slug, wager FROM currentGames where p1 = ?"
    db.query(selectQuery, [req.query.p1], async (err, result) => {
        if (result.length === 0) {
            res.send([])
        } else {
            const ctcInfo = result[0].contract
            const slug = result[0].slug
            const wager = result[0].wager
            res.send([slug, ctcInfo, wager])
        }
    })
})

app.get("/api/mustoptin", async (req, res) => {
    const selectQuery = "SELECT contract FROM contracts where who = ?"
    const ctcInfo = req.body.contract
    const adminCtc = adminAccount.contract(backend, ctcInfo)
    db.query(selectQuery, [req.query.who], async (err, result) => {
        if (result.length === 0) {
            res.send([0])
        } else {
            res.send([result[0].contract])
        }
    })
})

app.post("/api/newcontract", async (req, res) => {

    const adminCtc = adminAccount.contract(backend)

    await stdlib.withDisconnect(() =>
        adminCtc.p.Admin({
            adminAddress: ADMIN_ADDRESS,
            aliceAddress: req.body.p1,
            hasDeployed: stdlib.disconnect
        })
    )
    const ctcID = parseInt((await adminCtc.getInfo())._hex, 16)

    const insertQuery = "INSERT INTO contracts VALUES (?, ?)"
    db.query(insertQuery, [ctcID, req.body.p1], (err, result) => {
        res.send([ctcID])
    })

    
})

app.post("/api/newgame", (req, res) => {

    
    const selectQuery = "SELECT slug FROM currentGames"
    let existingSlugs
    db.query(selectQuery, (err, result) => {
        existingSlugs = result
        try {
            existingSlugs = existingSlugs.map((obj) => obj.slug)
        } catch {
            existingSlugs = []
        }
        let rand = 0
        while (rand < 100000 || existingSlugs.includes(rand)) {
            rand = Math.floor(Math.random() * 1000000)
        }
        const insertQuery = "INSERT INTO currentGames (slug, p1, contract, wager, gameVariant, timeControl, timeIncrement) VALUES (?, ?, ?, ?, ?, ?, ?)"
        const addr = req.body.p1
        const wager = req.body.wager
        const ctcInfo = req.body.contract
        const gameVariant = req.body.gameVariant
        const timeControl = req.body.timeControl
        const timeIncrement = req.body.timeIncrement
        
        db.query(insertQuery, [rand, addr, ctcInfo, wager, gameVariant, timeControl, timeIncrement], (err, result) => {
            res.send(String(rand))
        })
        
    })

    
})


app.get("/api/checkurls", (req, res) => {
    const query = "SELECT slug, p1, p2, wager, contract, gameVariant, timeControl, timeIncrement FROM currentGames"
    db.query(query, (err, result) => {
        res.send(result)
    })
})

app.post("/api/declinegame", async (req, res) => {
    const deleteQuery = "DELETE FROM currentGames WHERE contract = ?"
    db.query(deleteQuery, [req.body.contract], () => {
        res.send()
    })
})

app.post("/api/declinegamemakecall", async (req, res) => {
    const deleteQuery = "DELETE FROM currentGames WHERE contract = ?"
    db.query(deleteQuery, [req.body.contract], () => {
        res.send()
    })
    const adminCtc = adminAccount.contract(backend, req.body.contract)
    try {
        await adminCtc.apis.PlayerAPI.bobPaysWager(1)
    } catch (_) {}
})

app.get("/api/getgameurl", (req, res) => {
    const selectQuery = "SELECT gameUrl FROM currentGames WHERE contract = ?"
    db.query(selectQuery, [req.query.contract], (err, result) => {
        res.send(result[0].gameUrl)
    })
})

app.post("/api/processgame", (req, res) => {
    const ctcInfo = req.body.contract
    const slug = req.body.slug
    const adminCtc = adminAccount.contract(backend, ctcInfo)
    let outcome
    try {
        const checkQuery = "SELECT contract FROM currentGames WHERE slug = ?"
        db.query(checkQuery, [slug], async (err, result) => {
            if (result.length === 0) return
            if (result[0].contract !== ctcInfo) return // assert that the slug and contract match

            let res = ""
            try {
                res = (await Axios.get("https://lichess.org/game/export/" + req.body.gameID, {headers: {"Content-Type": "application/x-chess-pgn"}, params: {moves: false, clocks: false, evals: false, opening: false}})).data
            } catch (_) {}

            if (res.includes(`Result "*"`)) return // assert game finished

            if (res.includes(`Result "1-0"`)) {
                if (slug % 2 === 0) outcome = 0
                else outcome = 2
            } else if (res.includes(`Result "0-1"`)) {
                if (slug % 2 === 0) outcome = 2
                else outcome = 0
            } else {
                outcome = 1
            }
            try {
                await adminCtc.apis.PlayerAPI.sendOutcome(outcome, 0)
            } catch (e) {console.log(e); return}
            
            const updateQuery = "UPDATE currentGames SET winStatus = ? WHERE contract = ?"
            const insertQuery = "INSERT INTO allGames (p1, p2, dateCreated, winStatus, wager) SELECT p1, p2, dateCreated, winStatus, wager FROM currentGames WHERE contract = ?"
            const deleteQuery = "DELETE FROM currentGames WHERE contract = ?"
            db.query(updateQuery, [(outcome + 1), ctcInfo], () => {
                db.query(insertQuery, [ctcInfo], () => {
                    db.query(deleteQuery, [ctcInfo])
                })
            })
        })

    } catch (_) {}

    

})

app.post("/api/acceptgame", async (req, res) => {

    let params
    if (req.body.timeControl === 0 & req.body.timeIncrement === 0) {
        params = new URLSearchParams({
            variant: (["standard", "crazyhouse", "chess960", "kingOfTheHill", "threeCheck", "antichess", "atomic", "horde", "racingKings"])[req.body.gameVariant],
            rated: false,
            name: "AlgoChess",
        })
    } else {
        params = new URLSearchParams({
            "clock.limit": req.body.timeControl * 60,
            "clock.increment": req.body.timeIncrement,
            variant: (["standard", "crazyhouse", "chess960", "kingOfTheHill", "threeCheck", "antichess", "atomic", "horde", "racingKings"])[req.body.gameVariant],
            rated: false,
            name: "AlgoChess",
        })
    }
    let gameURL = ""
    try {
        gameURL = (await Axios.post("https://lichess.org/api/challenge/open", params)).data.challenge.id
    } catch (_) {}

    const updateQuery = 'UPDATE currentGames SET gameUrl = ?, p2 = ? WHERE contract = ?'
    db.query(updateQuery, [gameURL, req.body.address, req.body.contract], (err, result) => {
        res.send(gameURL)
    })

})

app.post("/api/undoaccept", async (req, res) => {

    const updateQuery = 'UPDATE currentGames SET gameUrl = NULL, p2 = NULL WHERE contract = ?'
    db.query(updateQuery, [req.body.contract], (err, result) => {
        res.send()
    })
})



app.listen(process.env.PORT || 3001, () => {
    console.log("running")
})


