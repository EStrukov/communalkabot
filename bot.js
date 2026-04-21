const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Создаем бота с поллингом
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Отключаем вывод пустых polling ошибок
bot.on('polling_error', (error) => {
  if (error.message && error.message !== 'ETELEGRAM: 409 Conflict: terminated by other getUpdates request') {
    console.log(`⚠️ Polling error: ${error.message}`);
  }
});

// Путь к файлу данных
const DATA_FILE = 'data.json';

// Загружаем данные
let data = { history: {}, lastReminder: null };
try {
  const loaded = require('./' + DATA_FILE);
  // Гарантируем что все поля всегда существуют
  data = {
    history: loaded.history || {},
    lastReminder: loaded.lastReminder || null
  };
} catch (e) {
  console.log('📄 Файл данных не найден, создаю новый');
}

// Сохраняем данные в файл
function saveData() {
  const fs = require('fs');
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Проверяем нужно ли отправить напоминание
function checkReminder(isStartupCheck = false) {
  const now = new Date();
  const day = now.getDate();
  const hours = now.getHours();
  const lastReminder = data.lastReminder;

  console.log(`[${now.toLocaleString()}] Проверка напоминаний... Сегодня ${day} число, ${hours} часов`);

  // Условия для отправки напоминания:
  const shouldSend = day >= 20 
    && (!lastReminder || new Date(lastReminder).getDate() !== day)
    && (isStartupCheck || hours === 13); // Только при старте или ровно в 13:00

  if (shouldSend) {
    console.log('✅ Отправляю напоминание всем чатам');
    sendReminder();
    data.lastReminder = now.toISOString();
    saveData();
  } else if (day >= 20) {
    if (new Date(lastReminder).getDate() === day) {
      console.log('ℹ️ Напоминание сегодня уже было отправлено');
    } else {
      console.log(`ℹ️ Напоминание будет отправлено сегодня в 13:00`);
    }
  } else {
    console.log(`ℹ️ До 20 числа еще рано`);
  }
}

// Отправляем напоминание всем пользователям
function sendReminder() {
  const chatId = Number(process.env.DEFAULT_CHAT_ID);
  
  if (!chatId) {
    console.log('❌ DEFAULT_CHAT_ID не указан в переменных окружения');
    return;
  }
  
  console.log(`✅ Отправляю напоминание в чат ${chatId}`);

  bot.sendMessage(chatId, '🔔 Внимание! Пришло время скинуть коммуналку! 🏠💰\nИспользуйте команду /communal')
    .then(() => {
      console.log(`✅ Напоминание успешно отправлено!`);
    })
    .catch(err => {
      console.log(`❌ Ошибка отправки:`, err.message);
    });
}

// Обработка команды /communal
bot.onText(/\/communal/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  console.log(`📩 Команда /communal получена, месяц: ${monthKey}, от пользователя: ${userName}`);

  // Инициализируем месяц если еще нет
  if (!data.history[monthKey]) {
    data.history[monthKey] = { communal: null, payment: null };
  }

  bot.sendMessage(chatId, `${userName}, отправь фото коммуналки 📸`);
  
  // Обрабатываем следующее сообщение как фото
  const messageListener = (incomingMsg) => {
    if (incomingMsg.chat.id === chatId && incomingMsg.photo) {
      const fileId = incomingMsg.photo[incomingMsg.photo.length - 1].file_id;
      data.history[monthKey].communal = { 
        fileId, 
        date: new Date().toISOString(),
        sentBy: userName
      };
      saveData();
      
      bot.sendMessage(chatId, `✅ Коммуналка за ${monthKey} сохранена!`);
      bot.removeListener('message', messageListener);
    }
  };
  
  bot.on('message', messageListener);
});

// Обработка команды /pay
bot.onText(/\/pay/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  console.log(`📩 Команда /pay получена, месяц: ${monthKey}, от пользователя: ${userName}`);

  // Инициализируем месяц если еще нет
  if (!data.history[monthKey]) {
    data.history[monthKey] = { communal: null, payment: null };
  }
  
  bot.sendMessage(chatId, `${userName}, отправь фото/ссылку на чек оплаты 💳`);
  
  // Обрабатываем следующее сообщение как фото/документ/текст
  const messageListener = (incomingMsg) => {
    if (incomingMsg.chat.id === chatId) {
      if (incomingMsg.photo || incomingMsg.document || incomingMsg.text) {
        let paymentInfo = null;
        
        if (incomingMsg.photo) {
          const fileId = incomingMsg.photo[incomingMsg.photo.length - 1].file_id;
          paymentInfo = { type: 'photo', fileId, date: new Date().toISOString(), paidBy: userName };
        } else if (incomingMsg.document) {
          const fileId = incomingMsg.document.file_id;
          paymentInfo = { type: 'document', fileId, date: new Date().toISOString(), paidBy: userName };
        } else if (incomingMsg.text) {
          paymentInfo = { type: 'text', content: incomingMsg.text, date: new Date().toISOString(), paidBy: userName };
        }
        
        data.history[monthKey].payment = paymentInfo;
        saveData();
        
        bot.sendMessage(chatId, `✅ Оплата за ${monthKey} сохранена!`);
        bot.removeListener('message', messageListener);
      }
    }
  };
  
  bot.on('message', messageListener);
});

// Обработка команды /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  console.log(`📩 Команда /status получена, запрошен статус за месяц: ${monthKey}`);

  const currentMonth = data.history[monthKey] || { communal: null, payment: null };
  
  let statusText = `📊 Статус за ${monthKey}:\n\n`;
  
  statusText += '📄 Коммуналка: ';
  if (currentMonth.communal) {
    statusText += `✅ Отправлена ${new Date(currentMonth.communal.date).toLocaleDateString()}\n`;
    statusText += `   Отправил: ${currentMonth.communal.sentBy}\n`;
  } else {
    statusText += '❌ Еще не отправлена\n';
  }
  
  statusText += '\n💳 Оплата: ';
  if (currentMonth.payment) {
    statusText += `✅ Оплачена ${new Date(currentMonth.payment.date).toLocaleDateString()}\n`;
    statusText += `   Оплатил: ${currentMonth.payment.paidBy}\n`;
  } else {
    statusText += '❌ Еще не оплачена\n';
  }

  if (currentMonth.communal && currentMonth.payment) {
    statusText += '\n🎉 Все сделано! На этом месяц закрыт.';
  } else if (currentMonth.communal) {
    statusText += '\n✓ Коммуналка собрана, осталось оплатить.';
  }
  
  bot.sendMessage(chatId, statusText);
});

// Проверяем напоминание при запуске (ждем полной инициализации бота 30 секунд)
setTimeout(() => {
  console.log('⏳ Прошло 30 секунд, бот полностью готов, проверяю напоминания');
  checkReminder(true); // true = это проверка при старте
  const now = new Date();
  const day = now.getDate();
  
  if (day >= 20 && !data.lastReminder) {
    console.log('⚠️ Сегодня >=20 число, напоминание будет отправлено');
  }
}, 10000);

// Проверяем напоминание каждый час
setInterval(() => checkReminder(false), 60 * 60 * 1000);

console.log('');
console.log('✅ Бот запущен и работает!');
console.log('📅 Напоминания включаются с 20 числа каждого месяца');
console.log('⏰ Автоматическое напоминание каждый день ровно в 13:00');
console.log('🔔 При старте бот сразу проверяет и отправляет если нужно');
console.log('💬 Сегодня напоминание уже было: ' + (data.lastReminder ? '✅ Да' : '❌ Нет'));
console.log('');
