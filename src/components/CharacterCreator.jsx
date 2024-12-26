import React, { useState } from "react";
import "./CharacterCreator.css";

// Initial stats for the character. All stats start at 8.
const initialStats = {
    Strength: 8,
    Dexterity: 8,
    Intelligence: 8,
    Wisdom: 8,
    Charisma: 8,
};

// Component for creating the character with stats and profile image upload.
const CharacterCreator = ({ onFinish }) => {
    // State for character stats. Initialized with initialStats.
    const [stats, setStats] = useState(initialStats);
    // State to manage the remaining points for stat allocation.
    const [remainingPoints, setRemainingPoints] = useState(20);
    // State to store the profile image URL.
    const [profileImage, setProfileImage] = useState(null);

    // Function to increase a stat by one, if remaining points are available.
    const handleIncrease = (stat) => {
        if (remainingPoints > 0) {
            setStats((prevStats) => ({ ...prevStats, [stat]: prevStats[stat] + 1 }));
            setRemainingPoints((prevPoints) => prevPoints - 1);
        }
    };

    // Function to decrease a stat by one, if it's not already at the minimum value.
    const handleDecrease = (stat) => {
        if (stats[stat] > 1) {
            setStats((prevStats) => ({ ...prevStats, [stat]: prevStats[stat] - 1 }));
            setRemainingPoints((prevPoints) => prevPoints + 1);
        }
    };

    // Function to handle image upload and set the profile image state.
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setProfileImage(URL.createObjectURL(file));
        }
    };

    // Function to finalize character creation and pass the data to the parent component.
    const handleFinish = () => {
        onFinish({ stats, profileImage });
    };

    return (
        <div className="character-creator">
            <h1>Create Your Character</h1>
            {/* Stats allocation section */}
            <div className="stats-container">
                <h2>Allocate Stats</h2>
                <p>Remaining Points: {remainingPoints}</p>
                <div className="stats-list">
                    {Object.keys(stats).map((stat) => (
                        <div key={stat} className="stat-item">
                            <span>{stat}</span>
                            <div className="stat-controls">
                                <button onClick={() => handleDecrease(stat)}>-</button>
                                <span>{stats[stat]}</span>
                                <button onClick={() => handleIncrease(stat)}>+</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
             {/* Profile image upload section */}
            <div className="profile-image-container">
                <h2>Upload Character Art</h2>
                <input type="file" onChange={handleImageUpload} />
                {profileImage && <img src={profileImage} alt="Character Art" />}
            </div>
             {/* Finish character creation button */}
            <button className="finish-button" onClick={handleFinish}>
                Finish & Start Adventure
            </button>
        </div>
    );
};

export default CharacterCreator;