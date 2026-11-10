/**
 * Run with: npm run seed:skills
 * Idempotent — safe to run multiple times, skips skills that already exist.
 */
require('dotenv').config();
const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');

const SKILLS = [
  // Academic
  { name: 'Mathematics', category: 'academic', icon: '\u2795', description: 'Arithmetic through advanced mathematics.' },
  { name: 'English Language', category: 'academic', icon: '\u{1F4D6}', description: 'Reading, writing, and comprehension.' },
  { name: 'Physics', category: 'academic', icon: '\u269B\uFE0F', description: 'Mechanics, energy, and the physical world.' },
  { name: 'Chemistry', category: 'academic', icon: '\u{1F9EA}', description: 'Reactions, elements, and lab skills.' },
  { name: 'Biology', category: 'academic', icon: '\u{1F9EC}', description: 'Living systems, from cells to ecosystems.' },
  { name: 'Computer Science', category: 'academic', icon: '\u{1F4BB}', description: 'Programming and computational thinking.' },

  // Mental
  { name: 'Critical Thinking', category: 'mental', icon: '\u{1F9E0}', description: 'Reasoning, logic, and problem-solving.' },
  { name: 'Memory & Focus', category: 'mental', icon: '\u{1F3AF}', description: 'Concentration and memory techniques.' },
  { name: 'Chess', category: 'mental', icon: '\u265F\uFE0F', description: 'Strategic thinking through chess.' },

  // Physical
  { name: 'Swimming', category: 'physical', icon: '\u{1F3CA}', description: 'Water safety and swimming technique.' },
  { name: 'Football', category: 'physical', icon: '\u26BD', description: 'Football skills and fitness.' },
  { name: 'Athletics', category: 'physical', icon: '\u{1F3C3}', description: 'Track and field fundamentals.' },

  // Creative
  { name: 'Music (Piano)', category: 'creative', icon: '\u{1F3B9}', description: 'Piano technique and music theory.' },
  { name: 'Drawing & Art', category: 'creative', icon: '\u{1F3A8}', description: 'Drawing, painting, and visual art.' },
  { name: 'Creative Writing', category: 'creative', icon: '\u270D\uFE0F', description: 'Storytelling and written expression.' },

  // Life skills
  { name: 'Financial Literacy', category: 'life', icon: '\u{1F4B0}', description: 'Money, budgeting, and saving basics.' },
  { name: 'Public Speaking', category: 'life', icon: '\u{1F5E3}\uFE0F', description: 'Confidence speaking in front of others.' },

  // Career
  { name: 'Coding for Kids', category: 'career', icon: '\u{1F468}\u200D\u{1F4BB}', description: 'Early exposure to programming careers.' },
  { name: 'Entrepreneurship', category: 'career', icon: '\u{1F4A1}', description: 'Basics of building and running a venture.' },
];

async function main() {
  await db.ready();

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const skill of SKILLS) {
    const existing = await db.prepare('SELECT id FROM skills WHERE name = ?').get(skill.name);
    if (existing) { skipped++; continue; }
    await db.prepare(
      'INSERT INTO skills (id, name, category, description, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), skill.name, skill.category, skill.description, skill.icon, now, now);
    inserted++;
  }

  console.log(`Skill catalog seeded: ${inserted} added, ${skipped} already existed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
