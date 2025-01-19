#!/bin/bash
cp articles.json output/ && cd output && zip -r ../cremer.zip . && cd .. && rm output/articles.json