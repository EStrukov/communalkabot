const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Создаем бота с поллингом
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Путь к файлу данных
const DATA_FILE = 'data.json';

// Загружаем данные
let data = {};
try {
  data = require('./' + DATA_FILE);
} catch (e) {
  data = { users: {}, lastReminder: null };
}

// Сохраняем данные в файл
function saveData() {
  const fs = require('fs');
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Проверяем нужно ли отправить напоминание
function checkReminder() {
  const now = new Date();
  const day = now.getDate();
  const lastReminder = data.lastReminder;

  // Если 20 число или после 20 числа и еще не было напоминания
  if (day >= 20 && (!lastReminder || new Date(lastReminder).getDate() !== day)) {
    sendReminder();
    data.lastReminder = now.toISOString();
    saveData();
  }
}

// Отправляем напоминание всем пользователям
function sendReminder() {
  // Получаем уникальные id чатов
  const uniqueChats = [...new Set(Object.values(data.users).map(u => u.chatId))];
  
  uniqueChats.forEach(chatId => {
    bot.sendMessage(chatId, '🔔 Внимание! Пришло время скинуть коммуналку! 🏠💰\nИспользуйте команду /communal');
  });
}

// Обработка команды /communal
bot.onText(/\/communal/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  const userKey = `${chatId}_${userId}`;

  // Сохраняем информацию о пользователе
  if (!data.users[userKey]) {
    data.users[userKey] = { id: userId, chatId: chatId, name: userName, communal: null, payment: null };
  }

  bot.sendMessage(chatId, `${userName}, отправь фото коммуналки 📸`);
  
  // Обрабатываем следующее сообщение как фото
  const messageListener = (incomingMsg) => {
    if (incomingMsg.chat.id === chatId && incomingMsg.from.id === userId && incomingMsg.photo) {
      const fileId = incomingMsg.photo[incomingMsg.photo.length - 1].file_id;
      data.users[userKey].communal = { fileId, date: new Date().toISOString() };
      saveData();
      
      bot.sendMessage(chatId, `✅ ${userName}, фото коммуналки сохранено!`);
      bot.removeListener('message', messageListener);
    }
  };
  
  bot.on('message', messageListener);
});

// Обработка команды /pay
bot.onText(/\/pay/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name;
  const userKey = `${chatId}_${userId}`;
  
  bot.sendMessage(chatId, `${userName}, отправь фото/ссылку на чек оплаты 💳`);
  
  // Обрабатываем следующее сообщение как фото/документ/текст
  const messageListener = (incomingMsg) => {
    if (incomingMsg.chat.id === chatId && incomingMsg.from.id === userId) {
      if (incomingMsg.photo || incomingMsg.document || incomingMsg.text) {
        let paymentInfo = null;
        
        if (incomingMsg.photo) {
          const fileId = incomingMsg.photo[incomingMsg.photo.length - 1].file_id;
          paymentInfo = { type: 'photo', fileId, date: new Date().toISOString() };
        } else if (incomingMsg.document) {
          const fileId = incomingMsg.document.file_id;
          paymentInfo = { type: 'document', fileId, date: new Date().toISOString() };
        } else if (incomingMsg.text) {
          paymentInfo = { type: 'text', content: incomingMsg.text, date: new Date().toISOString() };
        }
        
        data.users[userKey].payment = paymentInfo;
        saveData();
        
        bot.sendMessage(chatId, `✅ ${userName}, оплата сохранена!`);
        bot.removeListener('message', messageListener);
      }
    }
  };
  
  bot.on('message', messageListener);
});

// Обработка команды /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  
  // Получаем всех пользователей этого чата
  const chatUsers = Object.values(data.users).filter(u => u.chatId === chatId);
  
  if (chatUsers.length === 0) {
    bot.sendMessage(chatId, '👥 Никто еще не отправлял коммуналку в этом чате.\nИспользуйте команду /communal');
    return;
  }
  
  let statusText = '📊 Общий статус по чату:\n\n';
  
  chatUsers.forEach(user => {
    statusText += `👤 ${user.name}:\n`;
    statusText += user.communal ? '   ✅ Коммуналка отправлена\n' : '   ❌ Коммуналка не отправлена\n';
    statusText += user.payment ? '   ✅ Оплата подтверждена\n\n' : '   ❌ Оплата не подтверждена\n\n';
  });
  
  const allSent = chatUsers.every(u => u.communal);
  const allPaid = chatUsers.every(u => u.payment);
  
  if (allSent && allPaid) {
    statusText += '🎉 Все сделано! На этом месяц закрыт.';
  } else if (allSent) {
    statusText += '✓ Все коммуналки собраны, осталось оплатить.';
  }
  
  bot.sendMessage(chatId, statusText);
});

// Проверяем напоминание при запуске
checkReminder();

// Проверяем напоминание каждые 24 часа
setInterval(checkReminder, 24 * 60 * 60 * 1000);

console.log('Бот запущен! 🚀');