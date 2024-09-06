-- :zap: Add slashing_events indexes
--
-- Speed up join query by adding missing indexes
CREATE INDEX idx_slashing_events_address ON slashing_events (address);

CREATE INDEX idx_slashing_events_block_height ON slashing_events (block_height);

CREATE INDEX idx_slashing_events_chain_id ON slashing_events (chain_id);

CREATE INDEX idx_slashing_events_chain_block_address ON slashing_events (address, block_height, chain_id);

CREATE INDEX idx_blocks_height ON blocks (height);

CREATE INDEX idx_blocks_time ON blocks (time);

CREATE INDEX idx_blocks_height_time ON blocks (height, time);
