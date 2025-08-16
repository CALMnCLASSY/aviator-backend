// marketing/generatePlaceholders.js
const fs = require('fs');
const path = require('path');

// Create simple SVG placeholder images
const createPlaceholderSVG = (text, color, id) => {
    return `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="300" fill="${color}"/>
  <text x="200" y="120" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="middle" font-weight="bold">🎰 BIG WIN! 🎰</text>
  <text x="200" y="160" font-family="Arial, sans-serif" font-size="18" fill="white" text-anchor="middle">${text}</text>
  <text x="200" y="200" font-family="Arial, sans-serif" font-size="32" fill="#FFD700" text-anchor="middle" font-weight="bold">💰 ${id * 1000 + Math.floor(Math.random() * 5000)}$ 💰</text>
  <text x="200" y="240" font-family="Arial, sans-serif" font-size="16" fill="white" text-anchor="middle">avisignals.com</text>
</svg>`;
};

const placeholderData = [
    { text: "x15.6 Multiplier Hit!", color: "#FF6B6B" },
    { text: "x24.8 Jackpot Win!", color: "#4ECDC4" },
    { text: "x18.3 Big Cash Out!", color: "#45B7D1" },
    { text: "x31.2 Mega Win!", color: "#96CEB4" },
    { text: "x12.7 Success Story!", color: "#FFEAA7" },
    { text: "x22.4 Lightning Strike!", color: "#DDA0DD" },
    { text: "x19.8 On Fire Today!", color: "#F39C12" },
    { text: "x27.3 To The Moon!", color: "#8E44AD" },
    { text: "x16.5 Money Talks!", color: "#E74C3C" },
    { text: "x14.2 Bullseye Hit!", color: "#27AE60" },
    { text: "x33.7 Record Breaker!", color: "#3498DB" },
    { text: "x21.9 Perfect Timing!", color: "#E67E22" },
    { text: "x28.4 Unstoppable!", color: "#9B59B6" },
    { text: "x17.8 Dream Come True!", color: "#1ABC9C" },
    { text: "x25.1 Legendary Win!", color: "#34495E" }
];

// Generate placeholder images
const imagesDir = path.join(__dirname, 'images');

placeholderData.forEach((data, index) => {
    const svg = createPlaceholderSVG(data.text, data.color, index + 1);
    const filename = `win_${index + 1}.svg`;
    const filepath = path.join(imagesDir, filename);
    
    fs.writeFileSync(filepath, svg);
    console.log(`Created ${filename}`);
});

console.log('✅ All 15 placeholder images created successfully!');
