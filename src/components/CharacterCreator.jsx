import React, { useState } from "react";
import "./CharacterCreator.css";

const initialStats = {
  Strength: 8,
  Dexterity: 8,
  Intelligence: 8,
  Wisdom: 8,
  Charisma: 8,
};

const CharacterCreator = ({ onFinish }) => {
  const [stats, setStats] = useState(initialStats);
  const [remainingPoints, setRemainingPoints] = useState(20);
  const [profileImage, setProfileImage] = useState(null);

  const handleIncrease = (stat) => {
    if (remainingPoints > 0) {
      setStats({ ...stats, [stat]: stats[stat] + 1 });
      setRemainingPoints(remainingPoints - 1);
    }
  };

  const handleDecrease = (stat) => {
    if (stats[stat] > 1) {
      setStats({ ...stats, [stat]: stats[stat] - 1 });
      setRemainingPoints(remainingPoints + 1);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    setProfileImage(URL.createObjectURL(file));
  };

  const handleFinish = () => {
    // Pass character data to parent component or API
    onFinish({ stats, profileImage });
  };

  return (
    <div className="character-creator">
      <h1>Create Your Character</h1>
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
      <div className="profile-image-container">
        <h2>Upload Character Art</h2>
        <input type="file" onChange={handleImageUpload} />
        {profileImage && <img src={profileImage} alt="Character Art" />}
      </div>
      <button className="finish-button" onClick={handleFinish}>
        Finish & Start Adventure
      </button>
    </div>
  );
};

export default CharacterCreator;