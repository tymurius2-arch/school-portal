// Налаштування порталу.
// 1. Створи проєкт на https://console.firebase.google.com
// 2. Project settings → General → Your apps → додай Web app (</>)
// 3. Скопіюй сюди значення з блоку firebaseConfig.
export const firebaseConfig = {
  apiKey: "AIzaSyA-1R0PC8eJt5XixIsUh1yQ5nAnwHKTOq8",
  authDomain: "totosha-4fcc4.firebaseapp.com",
  projectId: "totosha-4fcc4",
  storageBucket: "totosha-4fcc4.firebasestorage.app",
  messagingSenderId: "460336392424",
  appId: "1:460336392424:web:2085e30390d5a31100415d"
};

export const SCHOOL = {
  name: "Наша школа",
  year: "2026/2027",
  // Канікули (орієнтовні дати — виправ, коли школа оголосить точні).
  breaks: [
    { name: "Осінні канікули", from: "2026-10-26", to: "2026-11-01" },
    { name: "Зимові канікули", from: "2026-12-24", to: "2027-01-11" },
    { name: "Весняні канікули", from: "2027-03-22", to: "2027-03-28" },
    { name: "Літні канікули", from: "2027-05-31", to: "2027-08-31" }
  ],
  // Свята для зворотного відліку. date: "ММ-ДД" — щороку, або повна дата "РРРР-ММ-ДД".
  holidays: [
    { name: "Хелловін", emoji: "🎃", date: "10-31" },
    { name: "День святого Миколая", emoji: "🎁", date: "12-06" },
    { name: "Різдво", emoji: "🎄", date: "12-25" },
    { name: "Новий рік", emoji: "🎆", date: "01-01" },
    { name: "День святого Валентина", emoji: "💌", date: "02-14" },
    { name: "8 Березня", emoji: "🌷", date: "03-08" },
    { name: "Великдень", emoji: "🥚", date: "2027-05-02" },
    { name: "Останній дзвоник", emoji: "🔔", date: "2027-05-28" },
    { name: "День знань", emoji: "📚", date: "09-01" }
  ],
  // Посилання на Telegram-чати з домашкою: номер класу → посилання.
  // Наприклад: 6: "https://t.me/+AbCdEf"
  telegram: {}
};
