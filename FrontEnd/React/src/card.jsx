import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';


export default function Card({ game, title, IMGsrc, idx, onClick }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            whileHover={{ y: -8, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
            onClick={onClick}
            className='game-card'
            style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
            <img src={IMGsrc} alt={title} className='game-card-image'/>
            <div className='game-card-overlay'>
                <h2>{title}</h2>
            </div>
        </motion.div>
    );
}