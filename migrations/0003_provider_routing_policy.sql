-- Migration: Add routing_policy column to providers table
-- Values: 'priority' (default), 'direct_only' (excluded from priority, target only), 'last_resort' (excluded from normal priority, used if all others fail)
ALTER TABLE providers ADD COLUMN routing_policy TEXT NOT NULL DEFAULT 'priority';
