//importer
require('dotenv').config();
const express = require('express');
const app = express();  
const jwt = require('jsonwebtoken');
const session = require('express-session');
const http = require('http');
const server = require('http').createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const logger = require('./modules/logger');
logger.info("Logger initialized");
const multer = require('multer');
const navlogin = require('./modules/auth/native');
const formbarAuth = require('./modules/auth/formbarAuth');
const socketModule = require('./modules/socketServer');
const userLayout = require('./modules/userLayout')
const instmanager = require('./modules/instanceManager')
//constants 
const PORT=process.env.PORT || 3000;
const SESSION_SECRET=process.env.SESSION_SECRET || "massacre";
const AUTH_URL=process.env.AUTH_URL || "https://localhost:420/oauth";
const THIS_URL=process.env.THIS_URL || "http://localhost:${PORT}";
const API_KEY = process.env.API_KEY || "12345";
const sqlite3 = require('sqlite3').verbose();   
const SQLiteStore = require('connect-sqlite3')(session)
const storage = multer.diskStorage({
destination: (req, file, cb) => {
    cb(null, 'db/uploads/');
},
filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
}
});
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);} 
        else {
        cb(new Error('Only image files (JPEG, PNG, GIF) are allowed!'), false);}};
const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }});
//database setup
const db = new sqlite3.Database('./db/database.db', (err) => {
    if (err) {
        logger.error(err.message);
    }
    logger.info('Connected to the database.');
});
const dbu = new sqlite3.Database('./db/uploads.db', (err) => {
    if (err) {
        logger.error(err.message);
    }
    logger.info('Connected to the uploaddatabase.');
});
const dbp = new sqlite3.Database('./db/virtpet.db', (err) => {
    if (err) {
        logger.error(err.message);
    }
    logger.info('Connected to the virtpet database.');
});
//middleware
const sessionMiddleware= require('./middleware/session')
const userapiroute= require('./routes/api/user')
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use('/api', userapiroute)
const midAuth = require('./middleware/isAuthenticated');
//routes
const mio = socketModule.createSocketServer(server, sessionMiddleware);
app.get('/',midAuth, (req, res) => {
    const indexData = userLayout.getUserData(req.session);
    res.render('index', { user: req.session.user});
});
app.post('/', midAuth, (req, res) => {
    itemerer=req.body.itemer;
    logger.info(`User ${req.session.user} found ${itemerer} rare items!`);
    dbp.run('UPDATE playerinv SET itemS5 = itemS5 + ? WHERE iid = ?', [itemerer, req.session.user], function (err) {
                if (err) { logger.error(err.message); }
                logger.info(`User ${req.session.user} total rare items updated by ${itemerer}`);
            });
    res.redirect('/');
});
app.get('/login', (req, res) => {
    if (req.query.token) {
        let tokenData = jwt.decode(req.query.token);
        req.session.token = tokenData;
        req.session.user = tokenData.displayName;
        let curdate= new Date();
        let curtime= curdate.toISOString().slice(0, 19).replace('T', ' ');
        logger.info(`Token for user ${tokenData.displayName} received at ${curtime}, expires at ${tokenData.exp}`);
        logger.info(`User ${tokenData.displayName} logged in.`);
         //save user to data bas if no exist
        db.run('INSERT OR IGNORE INTO users (username,passwordHash,formbarId,lastupdate) VALUES (?, ?, ?, ?)', [tokenData.displayName, null, tokenData.id, curtime], function (err) {
            if (err) {
                logger.error(err.message);
            }
            logger.info(`User ${tokenData.displayName} added to database or already exists.`);});
        
            res.redirect('/');
        } else {
        res.redirect(`${AUTH_URL}/oauth?redirectURL=${THIS_URL}`);
    };
});
app.post('/login', (req, res) => {
    let username1 = req.body.username;
    let password1 = req.body.password;
    let formbarId = req.body.formbarId;

    let curdate= new Date();
    let curtime= curdate.toISOString().slice(0, 19).replace('T', ' ');
    if (formbarId != null && formbarId != undefined) {
    db.run('INSERT OR IGNORE INTO users (username,passwordHash,formbarId,lastupdate) VALUES (?, ?, ?, ?)', [username1, null, formbarId, curtime], function (err) {
            if (err) {
                logger.error(err.message);
            }
            logger.info(`User ${tokenData.displayName} added to database or already exists.`);});
        
            res.redirect('/');
        }
    else { logger.error('Formbar ID is required');}
});
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});
app.get('/profile', midAuth, (req, res) => {
    const username = req.session.user;
    
    // Get user's ID first
    dbp.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user) {
            logger.error('Error finding user:', err?.message);
            // Still render page but with no pet
            dbu.all('SELECT * FROM Uploads', (err, uploads) => {
                if (err) uploads = [];
                const profileData = userLayout.getProfileData(req.session, uploads);
                profileData.pet = null; // No pet if user not found
                res.render('profile', profileData);
            });
            return;
        }
        
        // Get user's pet
        dbp.get('SELECT * FROM "owned pets" WHERE ownerid = ?', [user.id], (err, pet) => {
            if (err) {
                logger.error('Pet query error:', err.message);
                pet = null; // Set to null on error
            }
            
            // Get uploads
            dbu.all('SELECT * FROM Uploads', (err, uploads) => {
                if (err) {
                    logger.error('Uploads query error:', err.message);
                    uploads = [];
                }
                
                // Now pet is properly defined in this scope
                const profileData = userLayout.getProfileData(req.session, uploads);
                profileData.pet = pet; // This will work now
                
                console.log('Profile - Pet Data:', pet);
                console.log('Profile - User:', req.session.user);
                
                res.render('profile', profileData);
            });
        });
    });
});

// handling creating the pets
app.post('/profile', (req, res) => {
    const petName = req.body.petName;
    const petColor = req.body.petColor;
    const username = req.session.user;

    // getting user id first
    dbp.get('SELECT id FROM  users WHERE username = ?', [username], (err, user) => {
        if (err || !user) {
            logger.error('Error finding user for pet creation:', err?.message);
            return res.status(500).send('Error creating pet');
        }

        const userId = user.id;
        const initialHunger = 50;
        const initialJoy = 50;
        
        // create pet w proper owner id
        dbp.run('INSERT INTO "owned pets" (name, hunger, joy, color, ownerid) VALUES (?, ?, ?, ?, ?)',
            [petName, initialHunger, initialJoy, petColor, userId], function(err) {
            if (err) {
                logger.error('Error creating pet:', err.message);
                res.status(500).send('Error creating pet');
            } else {
                logger.info(`Pet ${petName} created for user ${username} (ID: ${userId})`);
                res.redirect('/profile');
            }
        });
    });
});
app.get('/sockets', (req, res) => {
    sockdata = userLayout.getUserData(req.session);
    res.render('sockets', sockdata);
});
app.get('/pet', midAuth, (req, res) => {
    // Get the user's ID from users table, then get their pet
    dbp.get('SELECT id FROM users WHERE username = ?', [req.session.user], (err, user) => {
        if (err || !user) {
            logger.error('Error finding user:', err?.message);
            const petData = userLayout.getUserData(req.session);
            petData.pet = null; // No pet data
            return res.render('pet', petData);
        }

        // getting the pet that belongs to the user
        dbp.get('SELECT * FROM "owned pets" WHERE ownerid = ?', [user.id], (err, pet) => {
            if (err) {
                logger.error('Pet query error:', err.message);
            }

            const petData = userLayout.getUserData(req.session);
            petData.pet = pet; // null if no pet found

            console.log('User ID:', user.id, 'Pet found:', pet); // debugging log
            res.render('pet', petData);
        });
    });
});
app.get('/chatroom', midAuth, (req, res) => {
    chatdata = userLayout.getUserData(req.session);
    res.render('chatroom', chatdata);
});
app.post('/chatroom/message', midAuth, (req, res) => {
    const message = req.body.message;
    const user = req.session.user;
    io.emit('chat message', { user, message });
    logger.info(`Chat message from ${user}: ${message}`);
    res.sendStatus(200);
});
app.get('/store', (req,res) => {
    res.render('store')
});
app.post('/store', (req,res) => {
let buyresponse=req.body.buyresponse;
let sellresponse=req.body.sellresponse;
logger.info(`User ${req.session.user} buy response: ${buyresponse}, sell response: ${sellresponse}`);
if (buyresponse) {
       //process buy
    logger.info(`Processing buy of item ${buyresponse} for user ${req.session.user}`);
    let uid = req.session.user;
    console.log(`buyresponse: ${buyresponse}`);
    if (buyresponse === '1')  {
        logger.info(`Buying item 1 ${buyresponse}`);
            dbp.run('Update playerinv SET itemS1 = 1 WHERE iid = ?', [uid], function (err) {
            if (err) {
                logger.error(err.message);
            }
            logger.info(`Item ${buyresponse}`);
            });
            dbp.run('UPDATE playerinv SET money = money - 1 WHERE iid = ?', [uid], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            });
            dbp.run('UPDATE storeInv SET money = money + 1 WHERE sid = ?', [1], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            }); 
            
        }
    else if (buyresponse === '2') { 
        dbp.run('UPDATE playerinv SET itemS2 = 1 WHERE iid = ?', [uid], function (err) {
            if (err) {
                logger.error(err.message);
            }
            logger.info(`Item ${buyresponse}`);
            });
            dbp.run('UPDATE playerinv SET money = money - 2 WHERE iid = ?', [uid], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            });
            dbp.run('UPDATE storeInv SET money = money + 2 WHERE sid = ?', [1], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            });
        }
    else if (buyresponse === '3') {
        dbp.run('UPDATE playerinv SET itemS3 = 1 WHERE iid = ?', [uid], function (err) {
            if (err) {
                logger.error(err.message);
            }
            logger.info(`Item ${buyresponse}`);
            });
            dbp.run('UPDATE playerinv SET money = money - 3 WHERE iid = ?', [uid], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            });
            dbp.run('UPDATE storeInv SET money = money + 3 WHERE sid = ?', [1], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            }); 
        }
    else { logger.warn(`Invalid buy response(numbers or no spaces most likely): ${buyresponse}`); };
    
    };

if (sellresponse) {
        //process sell
        logger.info(`Processing sell of item ${sellresponse} for user ${req.session.user}`);
        let uid = req.session.user;
        if (sellresponse === '1') { 
            dbp.run('UPDATE playerinv SET itemS1 = 0 WHERE iid = ?', [uid], function (err) {
                if (err) { logger.error(err.message); }
                logger.info(`Item ${sellresponse} sold`);
            });
            dbp.run('UPDATE playerinv SET money = money + 1 WHERE iid = ?', [uid], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            });
            dbp.run('UPDATE storeInv SET money = money - 1 WHERE sid = ?', [1], function (err) {
                if (err) {
                    logger.error(err.message);
                }
            });
        }
        else if (sellresponse === '2') {
            dbp.run('UPDATE playerinv SET itemS2 = 0 WHERE iid = ?', [uid], function (err) {
                if (err) { logger.error(err.message); }
                logger.info(`Item ${sellresponse} sold`);
            });
            dbp.run('UPDATE playerinv SET money = money + 2 WHERE iid = ?', [uid], function (err) {
                    if (err) {
                        logger.error(err.message);
                    }
            });
            dbp.run('UPDATE storeInv SET money = money - 2 WHERE sid = ?', [1], function (err) {
                    if (err) {
                        logger.error(err.message);
                    }
            });
            }
        else if (sellresponse === '3') {
            dbp.run('UPDATE playerinv SET itemS3 = 0 WHERE iid = ?', [uid], function (err) {
                if (err) { logger.error(err.message); } 
                logger.info(`Item ${sellresponse} sold`);
            });
            dbp.run('UPDATE playerinv SET money = money + 3 WHERE iid = ?', [uid], function (err) {
                    if (err) {
                        logger.error(err.message);
                    }
                });
            dbp.run('UPDATE storeInv SET money = money - 3 WHERE sid = ?', [1], function (err) {
                    if (err) {
                        logger.error(err.message);
                    }
                });
            }
        
        else { logger.warn(`Invalid sell response(numbers or no spaces most likely): ${sellresponse}`);};
        
    };
    res.redirect('/store');
});
// feed pet route
// Feed pet route
app.post('/pet/feed', midAuth, (req, res) => {
    dbp.get('SELECT * FROM "owned pets" LIMIT 1', (err, pet) => {
        if (err || !pet) {
            logger.error('Error finding pet:', err?.message);
            return res.status(500).send('Pet not found');
        }
        
        // Increase hunger (max 100)
        const newHunger = Math.min(pet.hunger + 20, 100);
        
        dbp.run('UPDATE "owned pets" SET hunger = ? WHERE pid = ?', 
            [newHunger, pet.pid], function(err) {
            if (err) {
                logger.error('Error feeding pet:', err.message);
                return res.status(500).send('Failed to feed pet');
            }
            
            logger.info(`Pet ${pet.name} fed. Hunger: ${pet.hunger} -> ${newHunger}`);
            res.redirect('/pet'); // Redirect back to pet page
        });
    });
});

// Play with pet route  
app.post('/pet/play', midAuth, (req, res) => {
    dbp.get('SELECT * FROM "owned pets" LIMIT 1', (err, pet) => {
        if (err || !pet) {
            logger.error('Error finding pet:', err?.message);
            return res.status(500).send('Pet not found');
        }
        
        // Increase joy (max 100)
        const newJoy = Math.min(pet.joy + 15, 100);
        
        dbp.run('UPDATE "owned pets" SET joy = ? WHERE pid = ?', 
            [newJoy, pet.pid], function(err) {
            if (err) {
                logger.error('Error playing with pet:', err.message);
                return res.status(500).send('Failed to play with pet');
            }
            
            logger.info(`Played with pet ${pet.name}. Joy: ${pet.joy} -> ${newJoy}`);
            res.redirect('/pet'); // Redirect back to pet page
        });
    });
});
// color change route
app.post('/pet/color', midAuth, (req, res) => {
    const username = req.session.user;
    const newColor = req.body.newColor;
    
    console.log(`Color change request: ${username} wants to change to ${newColor}`);
    
    // Get user's pet
    dbp.get('SELECT u.id, p.* FROM users u JOIN "owned pets" p ON u.id = p.ownerid WHERE u.username = ?', 
        [username], (err, pet) => {
        if (err || !pet) {
            logger.error('Error finding user\'s pet for color change:', err?.message);
            return res.status(500).send('Pet not found');
        }
        
        console.log(`Changing pet ${pet.name} color from ${pet.color} to ${newColor}`);
        
        // Update pet color
        dbp.run('UPDATE "owned pets" SET color = ? WHERE pid = ?', 
            [newColor, pet.pid], function(err) {
            if (err) {
                logger.error('Error updating pet color:', err.message);
                return res.status(500).send('Failed to update color');
            }
            
            logger.info(`Pet ${pet.name} color changed from ${pet.color} to ${newColor}`);
            res.redirect('/pet');
        });
    });
});

//minigame1 route
app.get('/minigame1', midAuth, (req, res) => {
    gamedata = userLayout.getUserData(req.session);
    res.render('minigame1', gamedata);
});
app.post('/minigame1', midAuth, (req, res) => {
    console.log("Full request body:", req.body);
    console.log("Looking for finalScore:", req.body.finalScore);
    console.log("Looking for fscore:", req.body.fscore);
    let nscore=req.body.finalScore / 2;
    logger.info(`User ${req.session.user} final score: ${nscore}`);
    let uid = req.session.user;
    dbp.run('UPDATE playerinv SET money = money + ? WHERE iid = ?', [nscore, uid], function (err) {
                if (err) { logger.error(err.message); } 
                logger.info(`User ${uid} new money added amount: ${nscore}`);
            });
});
//mingame2 route
app.get('/mingame2', midAuth, (req, res) => {
    gamedata = userLayout.getUserData(req.session);
    res.render('mingame2', gamedata);
}
);
app.post('/mingame2', midAuth, (req, res) => {
    console.log("mingame2post");
    Finalpun=req.body.answer
    FFinalpun=Finalpun.toLowerCase().trim();
    logger.info(`User ${req.session.user} final pun response: ${FFinalpun}`);
    let uid = req.session.user;
    if (FFinalpun === 'hippocampus') {
        dbp.run('UPDATE playerinv SET money = money + 5 WHERE iid = ?', [uid], function (err) {
                if (err) { logger.error(err.message); }
                logger.info(`User ${uid} answered correctly and earned 5 money!`);
            });
    }
});
//socket.io setup
io.on('connection', (socket) => {
    logger.info('a user connected');
    socket.on('update', (data) => {
    logger.info('Update received:', data);
    io.emit('update', data);
});
socket.on('connect_auth', () => {
    logger.info('Connected to auth server');
});

    

socket.on('disconnect', () => {
    logger.info('Disconnected from auth server',socket.id);
});
});

//start server
server.listen(PORT, () => {
    logger.info(`Example app listening on port http://localhost:${PORT}`);
});