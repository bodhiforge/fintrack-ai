-- Add raw_input column to store original user input for few-shot learning
ALTER TABLE transactions ADD COLUMN raw_input TEXT;
