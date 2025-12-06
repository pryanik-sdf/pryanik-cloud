require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
const jwtSecret = process.env.JWT_SECRET || 'default-secret';

const validator = require('validator');
const firebaseAdmin = require('firebase-admin');

// TODO: download Firebase key.json from Firebase Console > Settings > Service accounts > Generate new key
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert('./firebase-key.json'), // Замени на путь к твоему key.json
  databaseURL: 'https://your-project-id.firebaseio.com' // Замени на свой project ID
});

const firestoreDb = firebaseAdmin.firestore();

// Инициализация SQLite БД
const db = new sqlite3.Database('./database.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    parent_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(parent_id) REFERENCES folders(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    folder_id INTEGER DEFAULT NULL,
    filename TEXT,
    original_name TEXT,
    path TEXT,
    size INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(folder_id) REFERENCES folders(id)
  )`);
});

// Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middleware безопасности
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })); // 100 запросов за 15 мин с одного IP

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Middleware для аутентификации
const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.redirect('/login');
    req.user = user;
    next();
  });
};

// Роуты
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    pdf: 'fas fa-file-pdf',
    doc: 'fas fa-file-word',
    docx: 'fas fa-file-word',
    xls: 'fas fa-file-excel',
    xlsx: 'fas fa-file-excel',
    txt: 'fas fa-file-alt',
    jpg: 'fas fa-image',
    jpeg: 'fas fa-image',
    png: 'fas fa-image',
    gif: 'fas fa-image',
    zip: 'fas fa-file-archive',
    rar: 'fas fa-file-archive',
    mp3: 'fas fa-music',
    mp4: 'fas fa-video',
    avi: 'fas fa-video',
  };
  return icons[ext] || 'fas fa-file';
}

app.get('/', authenticate, (req, res) => {
  db.all('SELECT * FROM files WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) return res.send('Ошибка');
    getTotalSize(req.user.id, (total) => {
      res.render('index', { files: rows, getFileIcon, totalSize: total, storageLimit: STORAGE_LIMIT });
    });
  });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!validator.isEmail(email)) return res.render('login', { error: 'Неверный email' });
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
    if (err || !row) return res.render('login', { error: 'Неверные данные' });
    const match = await bcrypt.compare(password, row.password);
    if (!match) return res.render('login', { error: 'Неверные данные' });
    firestoreDb.collection('users').doc(row.id.toString()).get().then(doc => {
      const userData = doc.exists ? doc.data() : { status: 'user' };
      const token = jwt.sign({ id: row.id, email: row.email, status: userData.status }, jwtSecret, { expiresIn: '1h' });
      res.cookie('token', token, { httpOnly: true });
      res.redirect('/');
    }).catch(() => {
      const token = jwt.sign({ id: row.id, email: row.email, status: 'user' }, jwtSecret, { expiresIn: '1h' });
      res.cookie('token', token, { httpOnly: true });
      res.redirect('/');
    });
  });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!validator.isEmail(email)) return res.render('register', { error: 'Неверный email' });
  const hashed = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashed], function(err) {
    if (err) return res.render('register', { error: 'Email уже зарегистрирован' });
    const userId = this.lastID;
    firestoreDb.collection('users').doc(userId.toString()).set({
      email,
      firstName: '',
      lastName: '',
      status: 'user'
    }).catch(err => console.log('Firestore error:', err));
    res.redirect('/login');
  });
});

// Функция для получения общего размера файлов пользователя
function getTotalSize(user_id, callback) {
  db.get('SELECT SUM(size) as total FROM files WHERE user_id = ?', [user_id], (err, row) => {
    if (err) callback(0);
    else callback(row.total || 0);
  });
}

const STORAGE_LIMIT = 2.5 * 1024 * 1024 * 1024; // 2.5 GB

app.post('/upload', authenticate, upload.single('file'), (req, res) => {
  const { filename, originalname, size } = req.file;
  getTotalSize(req.user.id, (total) => {
    if (total + size > STORAGE_LIMIT) {
      return res.send('Лимит хранения превышен (2.5 ГБ)');
    }
    db.run('INSERT INTO files (user_id, filename, original_name, path, size) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, filename, originalname, req.file.path, size], (err) => {
        if (err) return res.send('Ошибка загрузки');
        res.redirect('/');
      });
  });
});

// Удаление файла
app.post('/delete/:id', authenticate, (req, res) => {
  db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, row) => {
    if (err || !row) return res.redirect('/');
    fs.unlink(row.path, (err) => {});
    db.run('DELETE FROM files WHERE id = ?', [req.params.id], () => {
      res.redirect('/');
    });
  });
});

app.post('/create-folder', authenticate, (req, res) => {
  const { folderName } = req.body;
  db.run('INSERT INTO folders (user_id, name) VALUES (?, ?)', [req.user.id, folderName], (err) => {
    if (err) return res.send('Ошибка создания папки');
    res.redirect('/');
  });
});

app.get('/download/:id', authenticate, (req, res) => {
  db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, row) => {
    if (err || !row) return res.send('Файл не найден');
    res.download(row.path, row.original_name);
  });
});

const adminAuth = (req, res, next) => {
  if (req.user.status !== 'admin') return res.send('Нет доступа');
  next();
};

app.get('/admin', authenticate, adminAuth, (req, res) => {
  db.all('SELECT email, id FROM users', [], (err, rows) => {
    if (err) return res.send('Ошибка');
    res.render('admin', { users: rows });
  });
});

app.post('/admin/delete-user/:id', authenticate, adminAuth, (req, res) => {
  const userId = req.params.id;
  db.run('DELETE FROM users WHERE id = ?', [userId], () => {
    firestoreDb.collection('users').doc(userId).delete().catch(err => console.log('Firestore error:', err));
    db.all('SELECT path FROM files WHERE user_id = ?', [userId], (err, rows) => {
      rows.forEach(row => fs.unlink(row.path, () => {}));
    });
    db.run('DELETE FROM files WHERE user_id = ?', [userId], () => {
      res.redirect('/admin');
    });
  });
});

app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

app.listen(port, host, () => {
  console.log(`Сервер работает на http://${host}:${port}`);
});
