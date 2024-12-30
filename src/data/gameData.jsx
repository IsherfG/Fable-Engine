// src/data/gameData.js
const gameData = {
    story: `The ancient evil of Malkor has awakened, spreading corruption across the land. The people of Oakhaven and beyond are in peril. The player characters are tasked with gathering allies, uncovering ancient artifacts, and ultimately confronting Malkor to restore balance to the world.`,
    lore: `Long ago, the world was protected by the 'Crystal of Harmony'. This crystal was shattered, its fragments scattered throughout the land. Malkor, the embodiment of chaos, seeks to gather these fragments to fuel his dark power.`,
    goal: `Collect the fragments of the Crystal of Harmony and defeat Malkor to save the land.`,
    playerCharacters: [
        {
            name: "Adventurer",
            description: "A novice adventurer seeking a new life in Oakhaven.",
        },
    ],
    locations: {
        Oakhaven: {
            name: "Oakhaven",
            description: "A small town known for its old ruins",
            sublocations: {
                "Town Gate": {
                    description: "The entrance to Oakhaven.",
                },
                "Market": {
                    description: "A place to buy and sell items.",
                },
                "Tavern": {
                    description: "A place to rest and socialize.",
                },
            },
            connections: ["Forest"],
            npcs: ["Old Man Hemlock", "Town Guard"],
             enemies: [],
        },
        Forest: {
            name: "Forest",
            description: "A large forest full of wild animals.",
            sublocations: {
                "Forest Path": {
                    description: "A narrow path through the trees",
                },
                "Clearing": {
                    description: "A small empty field.",
                },
            },
            connections: ["Oakhaven", "Dungeon"],
             npcs: [],
            enemies: [],
        },
        Dungeon: {
            name: "Dungeon",
             description: "A dark and mysterious underground complex",
            sublocations: {
                 "Dungeon Entrance": {
                    description: "The entrance to the dungeon."
                },
                "Corridor": {
                    description: "A long dark corridor.",
                },
            },
            connections: ["Forest"],
             npcs: [],
            enemies: ["goblin"], // Dungeon has goblins
        },
    },
    npcs: {
        "Old Man Hemlock": {
            description: "An old man with a kind face, sells items.",
             location: "Oakhaven",
            greeting: "Well hello there, adventurer, what brings you to our town?",
        },
        "Town Guard": {
            description: "A stern and watchful town guard",
             location: "Oakhaven",
             greeting: "Halt! State your purpose in our town!",
        },
    },
    enemies: {
        goblin: {
            name: "Goblin",
            description: "A small green creature that uses dirty fighting tactics.",
           health: 10,
            damage: 1,
            isAlive: true
        },
         skeleton: {
            name: "Skeleton",
            description: "A risen warrior from a bygone era, now serving as an undead minion.",
            health: 8,
            damage: 2,
            isAlive: true
        },
    },
   bosses: {
        malkor: {
            name: "Malkor",
            description: "The embodiment of chaos and evil, seeking to control the world",
        },
    },
    items: {
        "Basic Armor": {
            name: "Basic Armor",
            description: "A simple set of leather armor"
        },
        rustySword: {
            name: "Rusty Sword",
            description: "A weathered blade that is reliable but not powerful",
        },
         smallHealthPotion: {
            name: "Small Health Potion",
            description: "A small vial containing healing liquid",
        },
        oldBook: {
            name: "Old Book",
            description: "A dusty old book with ancient text."
         }
    },
};

export default gameData;