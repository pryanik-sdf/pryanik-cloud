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

// Инициализация БД
const db = new sqlite3.Database('./database.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    original_name TEXT,
    path TEXT,
    size INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
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
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) return res.render('login', { error: 'Неверные данные' });
    const match = await bcrypt.compare(password, row.password);
    if (!match) return res.render('login', { error: 'Неверные данные' });
    const token = jwt.sign({ id: row.id, username: row.username }, jwtSecret, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/');
  });
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed], (err) => {
    if (err) return res.render('register', { error: 'Пользователь уже существует' });
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

const STORAGE_LIMIT = 100 * 1024 * 1024; // 100 MB

app.post('/upload', authenticate, upload.single('file'), (req, res) => {
  const { filename, originalname, size } = req.file;
  getTotalSize(req.user.id, (total) => {
    if (total + size > STORAGE_LIMIT) {
      return res.send('Лимит хранения превышен (100 МБ)');
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

app.get('/download/:id', authenticate, (req, res) => {
  db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, row) => {
    if (err || !row) return res.send('Файл не найден');
    res.download(row.path, row.original_name);
  });
});

app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

app.listen(port, host, () => {
  console.log(`Сервер работает на http://${host}:${port}`);
});
