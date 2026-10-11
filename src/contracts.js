/**
 * Phase 1 data boundaries. These JSDoc contracts are intentionally descriptive:
 * they reserve stable shapes for later phases without implementing those systems.
 *
 * @typedef {{x:number,y:number}} MazePoint
 * @typedef {{width:number,height:number,cells:Array<Array<{x:number,y:number,walls:{N:boolean,E:boolean,S:boolean,W:boolean}}>>,start:MazePoint,end:MazePoint,seed?:number,id?:string}} MazeDefinition
 * @typedef {{id:string,kind:'single'|'guided-linked'|'mystery-linked',mazeIds:string[],storyPageId?:string,sequenceRuleId?:string}} AdventureLevel
 * @typedef {{id:string,title:string,body:string,illustrationKey?:string,levelIds:string[]}} StoryPage
 * @typedef {{version:number,completedLevelIds:string[],lastPlayedLevelId?:string,cosmetics:{pencilId:string,trailId:string,paperId:string},settings:{sound:boolean,reducedMotion:boolean}}} SaveData
 * @typedef {{id:string,category:'pencil'|'trail'|'paper',assetKey:string,unlockRule?:string}} CosmeticDefinition
 * @typedef {{attemptId:string,levelId:string,selectedMazeIds:string[],solvedMazeIds:string[],validated:boolean}} SequenceAttempt
 *
 * Mystery sequence validation belongs on the game side and must only reveal a
 * result after all mazes in an attempt are solved. No sequence data or feedback
 * is exposed by the Phase 1 UI.
 */
export const DATA_CONTRACT_VERSION = 1;
